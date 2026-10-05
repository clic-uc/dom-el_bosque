import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { attachments, importRemovals, importRows, imports, records } from '@/db/schema';
import type { AnalyzeImportData } from '@/shared/schemas/imports';
import type { Actor } from '../auth/session';
import { ConflictError, ValidationError, isAppError } from '../errors';
import type { Geocoder } from '../geocoding';
import { enqueue } from '../jobs/boss';
import { logger } from '../logger';
import { requireLayer, type LayerRow } from '../services/_shared';
import { buildIdentity } from '../services/duplicates';
import { analyzeRow, createBulkContext, initialResolution, resolveMapping, validateMapping } from './analysis';
import { assertOwnImport, requireImport } from './service';
import { readImportTable, type ImportRow } from './source';

type NewImportRow = typeof importRows.$inferInsert;

const ANALYZABLE_STATUSES = new Set<ImportRow['status']>(['UPLOADED', 'REVIEW', 'FAILED']);

/**
 * `POST /api/imports/:id/analyze` (§8.5): valida el mapeo, guarda las opciones y encola `import.analyze`.
 */
export async function startAnalyze(db: DbOrTx, actor: Actor, id: string, input: AnalyzeImportData): Promise<void> {
  const imp = await requireImport(db, id);
  assertOwnImport(actor, imp);
  if (!ANALYZABLE_STATUSES.has(imp.status)) {
    throw new ConflictError(
      imp.status === 'ANALYZING'
        ? 'La importación ya se está analizando. Espera a que termine.'
        : 'Esta importación ya fue confirmada o descartada; no se puede volver a analizar.',
    );
  }
  const layer = await requireLayer(db, imp.layerId);
  const table = await readImportTable(imp);
  validateMapping(layer, input, table.headers);

  const lastRow = table.rows[table.rows.length - 1]?.rowNumber ?? 0;
  if (lastRow === 0) throw new ValidationError('El archivo no tiene filas con datos debajo de los encabezados.');
  if (input.rowFrom && input.rowFrom > lastRow) {
    throw new ValidationError(`La fila inicial (${input.rowFrom}) es mayor que la última fila con datos del archivo (${lastRow}).`);
  }

  await db.transaction(async (tx) => {
    await tx.delete(importRows).where(eq(importRows.importId, id));
    await tx.delete(importRemovals).where(eq(importRemovals.importId, id));
    await tx
      .update(imports)
      .set({
        columnMapping: input.columnMapping,
        rowFrom: input.rowFrom ?? null,
        rowTo: input.rowTo ?? null,
        // Con reemplazo completo, lo que ya existe se actualiza en el lugar (§8.5 paso 4).
        duplicateStrategy: input.fullReplace ? 'update' : input.duplicateStrategy,
        keepExistingOnEmpty: input.keepExistingOnEmpty,
        geocode: input.geocode,
        fullReplace: input.fullReplace,
        status: 'ANALYZING',
        progress: { phase: 'queued', done: 0, total: 0, pendingGeocode: 0 },
        errorMessage: null,
        analyzedAt: null,
      })
      .where(eq(imports.id, id));
  });

  await enqueue('import.analyze', { importId: id });
}

export type AnalyzeDeps = { geocoder?: Geocoder; batchSize?: number };

/**
 * Handler de `import.analyze` (worker). Analiza todo en memoria y escribe `import_rows` en lotes de 1000.
 * Nunca lanza: deja la importación en REVIEW o FAILED.
 */
export async function runAnalyze(db: DbOrTx, importId: string, deps: AnalyzeDeps = {}): Promise<void> {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  if (!imp) return;
  if (imp.status !== 'ANALYZING') {
    logger.warn({ importId, status: imp.status }, 'import.analyze: estado inesperado, se ignora');
    return;
  }
  const batchSize = deps.batchSize ?? 1000;

  try {
    const layer = await requireLayer(db, imp.layerId);
    const table = await readImportTable(imp);
    const mapping = resolveMapping(layer, imp.columnMapping);
    const rows = table.rows.filter(
      (r) => (!imp.rowFrom || r.rowNumber >= imp.rowFrom) && (!imp.rowTo || r.rowNumber <= imp.rowTo),
    );
    const total = rows.length;

    const setProgress = (phase: string, done: number) =>
      db.update(imports).set({ progress: { phase, done, total, pendingGeocode: 0 } }).where(eq(imports.id, importId));

    await setProgress('preparing', 0);
    const ctx = await createBulkContext(db, layer, mapping, rows, imp.geocode, { geocoder: deps.geocoder });

    const pendingGeocode: number[] = [];
    const fileIdentityKeys = new Set<string>();
    let batch: NewImportRow[] = [];
    let done = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      await db.insert(importRows).values(batch);
      done += batch.length;
      batch = [];
      await setProgress('analyzing', done);
    };

    for (const r of rows) {
      const a = await analyzeRow(ctx, r.rowNumber, r.values);
      const res = initialResolution(a, imp.duplicateStrategy);
      if (a.identity?.complete) fileIdentityKeys.add(a.identity.key);
      if (a.needsExternalGeocode) pendingGeocode.push(r.rowNumber);
      batch.push({
        importId,
        rowNumber: r.rowNumber,
        raw: r.values,
        parsed: a.parsed,
        status: a.status,
        messages: a.messages,
        duplicateOf: a.duplicateOf,
        fileDuplicateOf: a.fileDuplicateOf,
        resolution: res.resolution,
        updateTargetId: res.updateTargetId,
      });
      if (batch.length >= batchSize) await flush();
    }
    await flush();

    if (imp.fullReplace) {
      await setProgress('removals', done);
      await computeRemovals(db, imp, layer, fileIdentityKeys);
    }

    await db
      .update(imports)
      .set({
        status: 'REVIEW',
        analyzedAt: new Date(),
        totalRows: total,
        progress: { phase: 'review', done: total, total, pendingGeocode: pendingGeocode.length },
      })
      .where(eq(imports.id, importId));

    // Las direcciones que el padrón no ubicó siguen en segundo plano (§8.7), una tarea por fila.
    for (let i = 0; i < pendingGeocode.length; i += 100) {
      await Promise.all(
        pendingGeocode.slice(i, i + 100).map((rowNumber) => enqueue('import.geocode-external', { importId, rowNumber })),
      );
    }
  } catch (err) {
    logger.error({ err, importId }, 'import.analyze falló');
    const message = isAppError(err)
      ? err.message
      : 'No se pudo analizar el archivo. Revisa que la hoja y la fila de encabezados sean correctas e intenta de nuevo.';
    await db
      .update(imports)
      .set({ status: 'FAILED', errorMessage: message, progress: { phase: 'failed' } })
      .where(eq(imports.id, importId));
  }
}

/**
 * Reemplazo completo (§8.5 paso 4): registros de la capa cuya identidad no viene en el archivo.
 * No borrables: con adjuntos o con correlativo asignado por la plataforma. Los creados en la plataforma
 * (no por una importación) se marcan con esa razón para revisarlos con cuidado.
 */
export async function computeRemovals(db: DbOrTx, imp: ImportRow, layer: LayerRow, fileIdentityKeys: Set<string>): Promise<number> {
  const existing = await db
    .select({
      id: records.id,
      roleId: records.roleId,
      attributes: records.attributes,
      numberAssignedAt: records.numberAssignedAt,
    })
    .from(records)
    .where(eq(records.layerId, layer.id));

  const missing = existing.filter((r) => {
    const idn = buildIdentity(layer, r.roleId, r.attributes);
    return idn?.complete && !fileIdentityKeys.has(idn.key);
  });
  if (missing.length === 0) return 0;

  const ids = missing.map((m) => m.id);
  const withAttachments = new Set<number>();
  const fromImports = new Set<number>();
  for (let i = 0; i < ids.length; i += 5000) {
    const part = ids.slice(i, i + 5000);
    const att = await db
      .selectDistinct({ entityId: attachments.entityId })
      .from(attachments)
      .where(and(eq(attachments.entityType, 'record'), inArray(attachments.entityId, part.map(String))));
    for (const a of att) withAttachments.add(Number(a.entityId));
    const imported = await db
      .selectDistinct({ recordId: importRows.recordId })
      .from(importRows)
      .where(and(isNotNull(importRows.recordId), inArray(importRows.recordId, part), eq(importRows.action, 'created')));
    for (const r of imported) if (r.recordId) fromImports.add(r.recordId);
  }

  const values: (typeof importRemovals.$inferInsert)[] = missing.map((m) => {
    let deletable = true;
    let reason: string | null = null;
    if (withAttachments.has(m.id)) {
      deletable = false;
      reason = 'Tiene documentos adjuntos';
    } else if (m.numberAssignedAt) {
      deletable = false;
      reason = 'Tiene un correlativo asignado por la plataforma';
    } else if (!fromImports.has(m.id)) {
      reason = 'Creado en la plataforma (no por una importación)';
    }
    return { importId: imp.id, recordId: m.id, deletable, reason, resolution: 'keep', deleted: false, snapshot: null };
  });

  for (let i = 0; i < values.length; i += 1000) {
    await db.insert(importRemovals).values(values.slice(i, i + 1000));
  }
  return values.length;
}

/** Cantidad de filas pendientes de geocodificación externa según `progress`. */
export function pendingGeocodeOf(imp: Pick<ImportRow, 'progress'>): number {
  return Number(imp.progress?.pendingGeocode ?? 0);
}

export const decrementPendingGeocodeSql = sql`jsonb_set(coalesce(progress, '{}'::jsonb), '{pendingGeocode}', to_jsonb(GREATEST(coalesce((progress->>'pendingGeocode')::int, 0) - 1, 0)))`;
