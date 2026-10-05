import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { importRemovals, importRows, imports, records, roles } from '@/db/schema';
import type { CoordsSource } from '@/shared/constants';
import type { RecordGeocodeInfo } from '@/shared/schemas/geocode';
import type { ParsedRow } from '@/shared/schemas/import-rows';
import type { Actor } from '../auth/session';
import { ConflictError } from '../errors';
import { enqueue } from '../jobs/boss';
import { logger } from '../logger';
import { recordColumns, requireLayer, type LayerRow, type RecordRowNoGeom } from '../services/_shared';
import * as attachmentsService from '../services/attachments';
import * as audit from '../services/audit';
import { applyRoleChange, roleAdoptCoordinates } from '../services/coordinates';
import { invalidateFilterOptions } from '../services/filters';
import { getAutonumberField } from '../services/numbering';
import { ensureRoles } from '../services/roles';
import { storage } from '../storage';
import { resolveMapping } from './analysis';
import { pendingGeocodeOf } from './analyze';
import { assertOwnImport, jsonify, requireImport, workerActor } from './service';
import type { ImportRow } from './source';

type ImportRowRecord = typeof importRows.$inferSelect;

/** `POST /api/imports/:id/commit` (§8.5 "Confirmar" paso 1). */
export async function startCommit(db: DbOrTx, actor: Actor, id: string, input: { acceptPendingGeocode: boolean }): Promise<void> {
  const imp = await requireImport(db, id);
  assertOwnImport(actor, imp);
  if (imp.status !== 'REVIEW') {
    throw new ConflictError(
      imp.status === 'COMMITTING'
        ? 'La importación ya se está guardando.'
        : imp.status === 'ANALYZING'
          ? 'La importación todavía se está analizando.'
          : 'Esta importación ya no está en revisión.',
    );
  }
  const [unresolved] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(importRows)
    .where(and(eq(importRows.importId, id), eq(importRows.status, 'duplicate'), isNull(importRows.resolution)));
  const n = Number(unresolved?.n ?? 0);
  if (n > 0) {
    throw new ConflictError(
      `Quedan ${n} fila${n === 1 ? '' : 's'} repetida${n === 1 ? '' : 's'} sin resolver. En la pestaña Duplicados elige omitir, actualizar el existente o crear igual.`,
      { unresolvedDuplicates: n },
    );
  }
  const pending = pendingGeocodeOf(imp);
  if (pending > 0 && !input.acceptPendingGeocode) {
    throw new ConflictError(
      `Todavía se están buscando ${pending} direcci${pending === 1 ? 'ón' : 'ones'} en OpenStreetMap. Si confirmas ahora, esas filas se importarán sin ubicación.`,
      { pendingGeocode: pending },
    );
  }
  await db
    .update(imports)
    .set({ status: 'COMMITTING', progress: { phase: 'queued', done: 0, total: 0, pendingGeocode: 0 }, errorMessage: null })
    .where(eq(imports.id, id));
  await enqueue('import.commit', { importId: id });
}

export type CommitDeps = { batchSize?: number };

type Plan =
  | { kind: 'insert'; row: ImportRowRecord; parsed: ParsedRow }
  | { kind: 'update'; row: ImportRowRecord; parsed: ParsedRow; targetId: number };

function planRow(row: ImportRowRecord): Plan | 'skipped' | 'failed' {
  if (row.status === 'excluded') return 'skipped';
  if (row.status === 'error' || !row.parsed) return 'failed';
  if (row.status === 'duplicate') {
    if (row.resolution === 'skip' || row.resolution === null) return 'skipped';
    if (row.resolution === 'update') {
      const target = row.updateTargetId ?? (row.duplicateOf.length === 1 ? row.duplicateOf[0]! : null);
      if (target === null) return 'skipped';
      return { kind: 'update', row, parsed: row.parsed, targetId: target };
    }
    return { kind: 'insert', row, parsed: row.parsed };
  }
  return { kind: 'insert', row, parsed: row.parsed };
}

const jsonbOrNull = (v: unknown) => (v === null || v === undefined ? sql`NULL::jsonb` : sql`${JSON.stringify(v)}::jsonb`);

type RoleCoords = { lat: number | null; lon: number | null };

/** Mezcla un registro existente con la fila importada (§8.5 "Confirmar" paso 2, actualizar en el lugar). */
export function mergeForUpdate(
  layer: LayerRow,
  imp: Pick<ImportRow, 'keepExistingOnEmpty'>,
  mappedKeys: string[],
  commentsMapped: boolean,
  existing: RecordRowNoGeom,
  parsed: ParsedRow,
  roleCoordsOf: (roleId: string) => RoleCoords | null,
): {
  roleId: string | null;
  lat: number | null;
  lon: number | null;
  coordsSource: CoordsSource | null;
  geocode: RecordGeocodeInfo | null;
  attributes: Record<string, unknown>;
  comments: string | null;
} {
  const roleId = parsed.roleId ?? existing.roleId;

  let coords = { lat: existing.lat, lon: existing.lon, coordsSource: existing.coordsSource, geocode: existing.geocode };
  if (parsed.coordsSource === 'own' && parsed.lat !== null && parsed.lon !== null) {
    coords = { lat: parsed.lat, lon: parsed.lon, coordsSource: 'own', geocode: null };
  } else if (existing.lat === null && parsed.lat !== null && parsed.lon !== null) {
    coords = { lat: parsed.lat, lon: parsed.lon, coordsSource: parsed.coordsSource, geocode: parsed.geocode };
  } else if (roleId !== existing.roleId) {
    const rc = roleId ? roleCoordsOf(roleId) : null;
    const next = applyRoleChange(coords, roleId ? { id: roleId, lat: rc?.lat ?? null, lon: rc?.lon ?? null } : null);
    coords = { lat: next.lat, lon: next.lon, coordsSource: next.coordsSource, geocode: next.geocode };
  }
  if (coords.coordsSource === 'role' && !roleId) coords = { ...coords, coordsSource: 'own', geocode: null };

  const auto = getAutonumberField(layer);
  const attributes: Record<string, unknown> = { ...existing.attributes };
  for (const key of mappedKeys) {
    // Un correlativo entregado por la plataforma no se pisa con el del archivo.
    if (auto && key === auto.key && existing.numberAssignedAt) continue;
    const v = parsed.attributes[key];
    if (v === null || v === undefined || v === '') {
      if (!imp.keepExistingOnEmpty) attributes[key] = null;
      continue;
    }
    attributes[key] = v;
  }

  const comments = commentsMapped && parsed.comments ? parsed.comments : existing.comments;
  return { roleId, ...coords, attributes, comments };
}

/**
 * Handler de `import.commit` (worker): escribe en lotes de 500, una transacción por lote; un lote fallido no
 * revierte los anteriores. Deja la importación en COMPLETED (con conteos) o FAILED si no pudo escribir nada.
 */
export async function runCommit(db: DbOrTx, importId: string, deps: CommitDeps = {}): Promise<void> {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  if (!imp) return;
  if (imp.status !== 'COMMITTING') {
    logger.warn({ importId, status: imp.status }, 'import.commit: estado inesperado, se ignora');
    return;
  }
  const batchSize = deps.batchSize ?? 500;
  const actor = workerActor(imp);
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
  let failedBatches = 0;

  try {
    const layer = await requireLayer(db, imp.layerId);
    const mapping = resolveMapping(layer, imp.columnMapping);
    const mappedKeys = mapping.fields.map((f) => f.field.key);
    const commentsMapped = mapping.commentsHeader !== null;

    const rows = await db.select().from(importRows).where(eq(importRows.importId, importId)).orderBy(asc(importRows.rowNumber));
    const plans: Plan[] = [];
    for (const row of rows) {
      const p = planRow(row);
      if (p === 'skipped') counts.skipped++;
      else if (p === 'failed') counts.failed++;
      else plans.push(p);
    }

    const removals = await db
      .select()
      .from(importRemovals)
      .where(and(eq(importRemovals.importId, importId), eq(importRemovals.resolution, 'delete'), eq(importRemovals.deletable, true)));

    const total = plans.length + removals.length;
    let done = 0;
    const setProgress = (phase: string) =>
      db.update(imports).set({ progress: { phase, done, total, pendingGeocode: 0 } }).where(eq(imports.id, importId));
    await setProgress('writing');

    // Roles nuevos en lote (§3.3 punto 18) y coordenadas actuales de los roles involucrados.
    const roleIds = [...new Set(plans.map((p) => p.parsed.roleId).filter((r): r is string => !!r))];
    await ensureRoles(db, roleIds);
    const roleCoords = new Map<string, RoleCoords>();
    for (let i = 0; i < roleIds.length; i += 5000) {
      const part = roleIds.slice(i, i + 5000);
      const found = await db.select({ id: roles.id, lat: roles.lat, lon: roles.lon }).from(roles).where(inArray(roles.id, part));
      for (const r of found) roleCoords.set(r.id, { lat: r.lat, lon: r.lon });
    }

    for (let i = 0; i < plans.length; i += batchSize) {
      const batch = plans.slice(i, i + batchSize);
      try {
        await db.transaction(async (tx) => {
          const inserts = batch.filter((p): p is Extract<Plan, { kind: 'insert' }> => p.kind === 'insert');
          const updates = batch.filter((p): p is Extract<Plan, { kind: 'update' }> => p.kind === 'update');

          const rowLinks: { rowNumber: number; recordId: number; action: 'created' | 'updated'; snapshot: unknown }[] = [];

          if (inserts.length) {
            const inserted = await tx
              .insert(records)
              .values(
                inserts.map((p) => ({
                  layerId: layer.id,
                  roleId: p.parsed.roleId,
                  lat: p.parsed.lat,
                  lon: p.parsed.lon,
                  coordsSource: p.parsed.coordsSource,
                  geocode: p.parsed.geocode,
                  attributes: p.parsed.attributes,
                  comments: p.parsed.comments ?? null,
                  createdBy: imp.userId,
                  updatedBy: imp.userId,
                })),
              )
              .returning({ id: records.id });
            inserts.forEach((p, idx) => {
              rowLinks.push({ rowNumber: p.row.rowNumber, recordId: inserted[idx]!.id, action: 'created', snapshot: null });
            });
            // El rol adopta las coordenadas propias del registro si no tenía (§8.3), una vez por rol.
            const adopted = new Set<string>();
            for (const p of inserts) {
              const rid = p.parsed.roleId;
              if (!rid || p.parsed.coordsSource !== 'own' || p.parsed.lat === null || p.parsed.lon === null) continue;
              const rc = roleCoords.get(rid);
              if (rc && rc.lat !== null) continue;
              if (adopted.has(rid)) continue;
              adopted.add(rid);
              if (await roleAdoptCoordinates(tx, rid, p.parsed.lat, p.parsed.lon)) {
                roleCoords.set(rid, { lat: p.parsed.lat, lon: p.parsed.lon });
              }
            }
          }

          if (updates.length) {
            const targetIds = [...new Set(updates.map((u) => u.targetId))];
            const existingRows = await tx.select(recordColumns).from(records).where(inArray(records.id, targetIds));
            const byId = new Map(existingRows.map((r) => [r.id, r]));
            const merged: { id: number; set: ReturnType<typeof mergeForUpdate>; snapshot: RecordRowNoGeom; rowNumber: number }[] = [];
            for (const u of updates) {
              const existing = byId.get(u.targetId);
              if (!existing || existing.layerId !== layer.id) {
                counts.skipped++;
                continue;
              }
              const set = mergeForUpdate(layer, imp, mappedKeys, commentsMapped, existing, u.parsed, (rid) => roleCoords.get(rid) ?? null);
              merged.push({ id: existing.id, set, snapshot: existing, rowNumber: u.row.rowNumber });
            }
            if (merged.length) {
              const values = sql.join(
                merged.map(
                  (m) =>
                    sql`(${m.id}::int, ${m.set.roleId}::varchar, ${m.set.lat}::double precision, ${m.set.lon}::double precision, ${m.set.coordsSource}::coords_source, ${jsonbOrNull(m.set.geocode)}, ${JSON.stringify(m.set.attributes)}::jsonb, ${m.set.comments}::text)`,
                ),
                sql`, `,
              );
              await tx.execute(sql`
                UPDATE records AS r
                SET role_id = v.role_id, lat = v.lat, lon = v.lon, coords_source = v.coords_source, geocode = v.geocode,
                    attributes = v.attributes, comments = v.comments, updated_by = ${imp.userId}, updated_at = now()
                FROM (VALUES ${values}) AS v(id, role_id, lat, lon, coords_source, geocode, attributes, comments)
                WHERE r.id = v.id
              `);
              for (const m of merged) {
                rowLinks.push({ rowNumber: m.rowNumber, recordId: m.id, action: 'updated', snapshot: jsonify(m.snapshot) });
              }
            }
          }

          if (rowLinks.length) {
            const values = sql.join(
              rowLinks.map((l) => sql`(${l.rowNumber}::int, ${l.recordId}::int, ${l.action}::import_row_action, ${jsonbOrNull(l.snapshot)})`),
              sql`, `,
            );
            await tx.execute(sql`
              UPDATE import_rows AS ir
              SET record_id = v.record_id, action = v.action, previous_snapshot = v.snapshot
              FROM (VALUES ${values}) AS v(row_number, record_id, action, snapshot)
              WHERE ir.import_id = ${importId} AND ir.row_number = v.row_number
            `);
          }

          counts.created += rowLinks.filter((l) => l.action === 'created').length;
          counts.updated += rowLinks.filter((l) => l.action === 'updated').length;
        });
      } catch (err) {
        failedBatches++;
        counts.failed += batch.length;
        logger.error({ err, importId, batchStart: i }, 'import.commit: lote fallido');
      }
      done += batch.length;
      await setProgress('writing');
    }

    // Reemplazo completo: borrar los marcados (todos sin adjuntos ni correlativo, porque son los únicos borrables).
    for (let i = 0; i < removals.length; i += batchSize) {
      const batch = removals.slice(i, i + batchSize);
      const ids = batch.map((r) => r.recordId);
      try {
        const keys = await db.transaction(async (tx) => {
          const existingRows = await tx.select(recordColumns).from(records).where(and(inArray(records.id, ids), eq(records.layerId, layer.id)));
          if (existingRows.length === 0) return [] as string[];
          const values = sql.join(
            existingRows.map((r) => sql`(${r.id}::int, ${JSON.stringify(jsonify(r))}::jsonb)`),
            sql`, `,
          );
          await tx.execute(sql`
            UPDATE import_removals AS ir
            SET deleted = true, snapshot = v.snapshot
            FROM (VALUES ${values}) AS v(record_id, snapshot)
            WHERE ir.import_id = ${importId} AND ir.record_id = v.record_id
          `);
          const existingIds = existingRows.map((r) => r.id);
          const storageKeys = await attachmentsService.deleteForEntity(tx, 'record', existingIds.map(String));
          await tx.delete(records).where(inArray(records.id, existingIds));
          counts.deleted += existingIds.length;
          return storageKeys;
        });
        await attachmentsService.purgeStorageKeys(keys);
      } catch (err) {
        failedBatches++;
        logger.error({ err, importId, batchStart: i }, 'import.commit: lote de eliminaciones fallido');
      }
      done += batch.length;
      await setProgress('deleting');
    }

    const wroteSomething = counts.created + counts.updated + counts.deleted > 0;
    const status = failedBatches > 0 && !wroteSomething ? 'FAILED' : 'COMPLETED';
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(imports)
        .set({
          status,
          committedAt: now,
          createdCount: counts.created,
          updatedCount: counts.updated,
          skippedCount: counts.skipped,
          failedCount: counts.failed,
          deletedCount: counts.deleted,
          progress: { phase: status === 'COMPLETED' ? 'completed' : 'failed', done: total, total, pendingGeocode: 0 },
          errorMessage:
            status === 'FAILED'
              ? 'No se pudo guardar ningún registro. Revisa el archivo e intenta de nuevo; si el problema sigue, avisa al administrador.'
              : failedBatches > 0
                ? `Algunos lotes no se pudieron guardar (${counts.failed} filas quedaron como fallidas).`
                : null,
          fileKey: null,
        })
        .where(eq(imports.id, importId));
      await audit.log(tx, {
        actor,
        action: 'IMPORT',
        entityType: 'IMPORT',
        entityId: importId,
        layerId: layer.id,
        metadata: { fileName: imp.fileName, fullReplace: imp.fullReplace, ...counts, failedBatches },
      });
    });
    if (imp.fileKey) await storage.delete(imp.fileKey);
    invalidateFilterOptions(layer.id);
  } catch (err) {
    logger.error({ err, importId }, 'import.commit falló');
    await db
      .update(imports)
      .set({
        status: 'FAILED',
        errorMessage: 'No se pudo completar la importación. Intenta de nuevo; si el problema sigue, avisa al administrador.',
        createdCount: counts.created,
        updatedCount: counts.updated,
        skippedCount: counts.skipped,
        failedCount: counts.failed,
        deletedCount: counts.deleted,
        progress: { phase: 'failed' },
      })
      .where(eq(imports.id, importId));
  }
}
