import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { importRemovals, importRows, imports, records } from '@/db/schema';
import type { ImportRevertResult, RecordDto } from '@/shared/types';
import type { Actor } from '../auth/session';
import { ConflictError, ForbiddenError } from '../errors';
import * as attachmentsService from '../services/attachments';
import * as audit from '../services/audit';
import { invalidateFilterOptions } from '../services/filters';
import { ensureRoles } from '../services/roles';
import { requireImport } from './service';

const jsonbOrNull = (v: unknown) =>
  v === null || v === undefined ? sql`NULL::jsonb` : sql`${JSON.stringify(v)}::jsonb`;
const tsOrNull = (v: string | null | undefined) => (v ? sql`${v}::timestamptz` : sql`NULL::timestamptz`);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * `POST /api/imports/:id/revert` (§8.5 "Después"): borra los creados, restaura los actualizados desde
 * `previousSnapshot` y reinserta los borrados por reemplazo completo con su id original. Editor: solo propias.
 */
export async function revertImport(
  db: DbOrTx,
  actor: Actor,
  id: string,
  input: { force: boolean },
): Promise<ImportRevertResult> {
  const imp = await requireImport(db, id);
  if (actor.role !== 'admin' && imp.userId !== actor.userId) {
    throw new ForbiddenError('Solo quien hizo esta importación o un administrador puede revertirla.');
  }
  if (imp.status !== 'COMPLETED' || !imp.committedAt) {
    throw new ConflictError(
      imp.status === 'REVERTED'
        ? 'Esta importación ya fue revertida.'
        : 'Solo se puede revertir una importación completada.',
    );
  }

  const rows = await db
    .select({
      rowNumber: importRows.rowNumber,
      recordId: importRows.recordId,
      action: importRows.action,
      previousSnapshot: importRows.previousSnapshot,
    })
    .from(importRows)
    .where(and(eq(importRows.importId, id), isNotNull(importRows.action)));
  const created = rows.filter((r) => r.action === 'created' && r.recordId !== null).map((r) => r.recordId!);
  const updated = rows
    .filter((r) => r.action === 'updated' && r.recordId !== null && r.previousSnapshot)
    .map((r) => ({ id: r.recordId!, snapshot: r.previousSnapshot as RecordDto }));
  const removed = await db
    .select({ recordId: importRemovals.recordId, snapshot: importRemovals.snapshot })
    .from(importRemovals)
    .where(
      and(
        eq(importRemovals.importId, id),
        eq(importRemovals.deleted, true),
        isNotNull(importRemovals.snapshot),
      ),
    );

  const touched = [...created, ...updated.map((u) => u.id)];
  if (!input.force && touched.length) {
    const modified: number[] = [];
    for (const part of chunk(touched, 5000)) {
      const found = await db
        .select({ id: records.id })
        .from(records)
        .where(and(inArray(records.id, part), gt(records.updatedAt, imp.committedAt)));
      modified.push(...found.map((f) => f.id));
    }
    if (modified.length) {
      throw new ConflictError(
        `${modified.length} registro${modified.length === 1 ? ' fue modificado' : 's fueron modificados'} después de la importación. Si reviertes igual, esos cambios se perderán.`,
        { modifiedRecordIds: modified.slice(0, 100), count: modified.length },
      );
    }
  }

  const result: ImportRevertResult = { deletedRecords: 0, restoredRecords: 0, reinsertedRecords: 0 };
  const storageKeys: string[] = [];

  await db.transaction(async (tx) => {
    // 1. borrar los creados (y sus adjuntos)
    for (const part of chunk(created, 5000)) {
      storageKeys.push(...(await attachmentsService.deleteForEntity(tx, 'record', part.map(String))));
      const deleted = await tx.delete(records).where(inArray(records.id, part)).returning({ id: records.id });
      result.deletedRecords += deleted.length;
    }

    // 2. restaurar los actualizados desde el snapshot
    const snapshotRoles = [
      ...updated.map((u) => u.snapshot.roleId),
      ...removed.map((r) => (r.snapshot as RecordDto).roleId),
    ].filter((r): r is string => !!r);
    await ensureRoles(tx, snapshotRoles);

    for (const part of chunk(updated, 500)) {
      const values = sql.join(
        part.map(
          (u) =>
            sql`(${u.id}::int, ${u.snapshot.roleId}::varchar, ${u.snapshot.lat}::double precision, ${u.snapshot.lon}::double precision, ${u.snapshot.coordsSource}::coords_source, ${jsonbOrNull(u.snapshot.geocode)}, ${JSON.stringify(u.snapshot.attributes)}::jsonb, ${u.snapshot.comments}::text, ${tsOrNull(u.snapshot.numberAssignedAt)}, ${u.snapshot.numberAssignedBy}::varchar)`,
        ),
        sql`, `,
      );
      const restored = await tx.execute<{ id: number }>(sql`
        UPDATE records AS r
        SET role_id = v.role_id, lat = v.lat, lon = v.lon, coords_source = v.coords_source, geocode = v.geocode,
            attributes = v.attributes, comments = v.comments, number_assigned_at = v.number_assigned_at,
            number_assigned_by = v.number_assigned_by, updated_by = ${actor.userId}, updated_at = now()
        FROM (VALUES ${values}) AS v(id, role_id, lat, lon, coords_source, geocode, attributes, comments, number_assigned_at, number_assigned_by)
        WHERE r.id = v.id
        RETURNING r.id
      `);
      result.restoredRecords += restored.length;
    }

    // 3. reinsertar los borrados por reemplazo completo con su id original
    for (const part of chunk(removed, 500)) {
      const inserted = await tx
        .insert(records)
        .values(
          part.map((r) => {
            const s = r.snapshot as RecordDto;
            return {
              id: s.id,
              layerId: s.layerId,
              roleId: s.roleId,
              lat: s.lat,
              lon: s.lon,
              coordsSource: s.coordsSource,
              geocode: s.geocode,
              attributes: s.attributes,
              comments: s.comments,
              numberAssignedAt: s.numberAssignedAt ? new Date(s.numberAssignedAt) : null,
              numberAssignedBy: s.numberAssignedBy,
              createdBy: s.createdBy,
              updatedBy: actor.userId,
              createdAt: s.createdAt ? new Date(s.createdAt) : undefined,
            };
          }),
        )
        .onConflictDoNothing({ target: records.id })
        .returning({ id: records.id });
      result.reinsertedRecords += inserted.length;
    }
    if (removed.length) {
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence('records', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM records), 1))`,
      );
    }

    await tx
      .update(imports)
      .set({ status: 'REVERTED', revertedAt: new Date(), revertedBy: actor.userId })
      .where(eq(imports.id, id));
    await audit.log(tx, {
      actor,
      action: 'REVERT',
      entityType: 'IMPORT',
      entityId: id,
      layerId: imp.layerId,
      metadata: { fileName: imp.fileName, ...result, forced: input.force },
    });
  });

  await attachmentsService.purgeStorageKeys(storageKeys);
  invalidateFilterOptions(imp.layerId);
  return result;
}
