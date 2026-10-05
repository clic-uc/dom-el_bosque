import { and, asc, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { importRemovals, importRows, imports, records } from '@/db/schema';
import type { Paginated } from '@/shared/schemas/common';
import type { GeocodeCandidate, RecordGeocodeInfo } from '@/shared/schemas/geocode';
import type { ImportMessage, ParsedRow } from '@/shared/schemas/import-rows';
import type {
  ImportRemovalsPatch,
  ImportRowPatch,
  ImportRowStatus,
  ImportRowsBulkInput,
  ImportRowsQuery,
} from '@/shared/schemas/imports';
import type { ImportRemovalDto, ImportRowDto, ImportStatusCounts, ImportStatusDto, ImportStatusFull } from '@/shared/types';
import type { Actor } from '../auth/session';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import type { Geocoder } from '../geocoding';
import { buildSummary, requireLayer, type LayerRow } from '../services/_shared';
import { previewNextNumber } from '../services/numbering';
import { storage } from '../storage';
import {
  RAW_OVERRIDE_KEYS,
  analyzeRow,
  applyLocation,
  createIncrementalContext,
  initialResolution,
  isRawOverrideKey,
  resolveMapping,
  statusFromMessages,
  type AnalysisContext,
} from './analysis';
import { pendingGeocodeOf } from './analyze';
import { assertOwnImport, jsonify, requireImport, toImportItem } from './service';
import type { ImportRow } from './source';
import { getImportSource } from './upload';

type ImportRowRecord = typeof importRows.$inferSelect;

// ---------- estado ----------

export async function getStatus(db: DbOrTx, id: string, opts: { includeSource?: boolean } = {}): Promise<ImportStatusFull> {
  const imp = await requireImport(db, id);
  const layer = await requireLayer(db, imp.layerId);

  const [byStatus, [unresolved], codeRows, removalRows, next] = await Promise.all([
    db
      .select({ status: importRows.status, n: count() })
      .from(importRows)
      .where(eq(importRows.importId, id))
      .groupBy(importRows.status),
    db
      .select({ n: count() })
      .from(importRows)
      .where(and(eq(importRows.importId, id), eq(importRows.status, 'duplicate'), isNull(importRows.resolution))),
    db.execute<{ code: string; n: number }>(sql`
      SELECT m->>'code' AS code, count(DISTINCT r.row_number)::int AS n
      FROM import_rows r, jsonb_array_elements(r.messages) m
      WHERE r.import_id = ${id} AND r.status <> 'excluded'
      GROUP BY 1
    `),
    imp.fullReplace
      ? db
          .select({
            total: count(),
            toDelete: sql<number>`count(*) FILTER (WHERE ${importRemovals.resolution} = 'delete')::int`,
            notDeletable: sql<number>`count(*) FILTER (WHERE NOT ${importRemovals.deletable})::int`,
          })
          .from(importRemovals)
          .where(eq(importRemovals.importId, id))
      : Promise.resolve(null),
    previewNextNumber(db, imp.layerId).catch(() => null),
  ]);

  const counts: ImportStatusCounts = { valid: 0, warning: 0, duplicate: 0, error: 0, excluded: 0, unresolvedDuplicates: Number(unresolved?.n ?? 0) };
  for (const r of byStatus) counts[r.status] = Number(r.n);
  const codeCounts: Record<string, number> = {};
  for (const r of codeRows) codeCounts[r.code] = Number(r.n);

  const autoField = next ? layer.fields.find((f) => f.key === next.fieldKey) : undefined;
  const removals = removalRows?.[0];

  const status: ImportStatusDto = {
    ...toImportItem(imp, layer.name),
    counts,
    codeCounts,
    ...(removals
      ? { removals: { total: Number(removals.total), toDelete: Number(removals.toDelete), notDeletable: Number(removals.notDeletable) } }
      : {}),
    nextNumber: next && autoField ? { fieldKey: next.fieldKey, label: autoField.label, next: next.next } : null,
  };

  const full: ImportStatusFull = {
    ...status,
    layer: {
      id: layer.id,
      name: layer.name,
      hasRole: layer.hasRole,
      fields: layer.fields,
      uniqueKeys: layer.uniqueKeys,
      addressFieldKey: layer.addressFieldKey,
    },
    pendingGeocode: pendingGeocodeOf(imp),
  };
  if (opts.includeSource && imp.fileKey) {
    try {
      full.source = await getImportSource(db, imp, layer);
    } catch {
      // sin archivo (vencido o borrado): el asistente mostrará el estado sin vista previa
    }
  }
  return full;
}

// ---------- filas ----------

function rowsWhere(id: string, filter: { status?: ImportRowStatus; code?: string }): SQL {
  const conds: SQL[] = [eq(importRows.importId, id)];
  if (filter.status) conds.push(eq(importRows.status, filter.status));
  if (filter.code) conds.push(sql`${importRows.messages} @> ${JSON.stringify([{ code: filter.code }])}::jsonb`);
  return and(...conds)!;
}

async function attachExisting(db: DbOrTx, rows: ImportRowRecord[]): Promise<ImportRowDto[]> {
  const ids = new Set<number>();
  for (const r of rows) {
    for (const d of r.duplicateOf) ids.add(d);
    if (r.updateTargetId) ids.add(r.updateTargetId);
  }
  const existing = ids.size
    ? await db
        .select({ id: records.id, roleId: records.roleId, attributes: records.attributes, updatedAt: records.updatedAt })
        .from(records)
        .where(inArray(records.id, [...ids]))
    : [];
  const byId = new Map(existing.map((e) => [e.id, { ...e, updatedAt: e.updatedAt.toISOString() }]));
  return rows.map((r) => {
    const dto = jsonify(r) as ImportRowDto;
    const wanted = [...new Set([...r.duplicateOf, ...(r.updateTargetId ? [r.updateTargetId] : [])])];
    const ex = wanted.map((i) => byId.get(i)).filter((x): x is NonNullable<typeof x> => !!x);
    if (ex.length) dto.existing = ex;
    return dto;
  });
}

export async function listRows(db: DbOrTx, id: string, q: ImportRowsQuery): Promise<Paginated<ImportRowDto>> {
  await requireImport(db, id);
  const where = rowsWhere(id, q);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(importRows)
      .where(where)
      .orderBy(asc(importRows.rowNumber))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(importRows).where(where),
  ]);
  return { data: await attachExisting(db, rows), total: Number(totals[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
}

async function requireRow(db: DbOrTx, id: string, rowNumber: number): Promise<ImportRowRecord> {
  const [row] = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.importId, id), eq(importRows.rowNumber, rowNumber)))
    .limit(1);
  if (!row) throw new NotFoundError(`La fila ${rowNumber} no está en esta importación`);
  return row;
}

function requireReview(imp: ImportRow): void {
  if (imp.status !== 'REVIEW') {
    throw new ConflictError(
      imp.status === 'ANALYZING'
        ? 'La importación todavía se está analizando. Espera a que termine para revisar las filas.'
        : 'Esta importación ya no está en revisión.',
    );
  }
}

export type ReviewDeps = { geocoder?: Geocoder };

type ReviewSession = { imp: ImportRow; layer: LayerRow; ctx: AnalysisContext };

async function openSession(db: DbOrTx, actor: Actor, id: string, deps: ReviewDeps): Promise<ReviewSession> {
  const imp = await requireImport(db, id);
  assertOwnImport(actor, imp);
  requireReview(imp);
  const layer = await requireLayer(db, imp.layerId);
  const mapping = resolveMapping(layer, imp.columnMapping);
  const ctx = createIncrementalContext(db, id, layer, mapping, imp.geocode, { geocoder: deps.geocoder });
  return { imp, layer, ctx };
}

/** Re-analiza una fila con su `raw` actual y conserva la resolución si sigue siendo válida. */
async function reanalyze(
  s: ReviewSession,
  row: ImportRowRecord,
  raw: Record<string, string>,
): Promise<Partial<typeof importRows.$inferInsert>> {
  const a = await analyzeRow(s.ctx, row.rowNumber, raw);
  let resolution = row.resolution;
  let updateTargetId = row.updateTargetId;
  const stillValidUpdate = resolution === 'update' && updateTargetId !== null && a.duplicateOf.includes(updateTargetId);
  if (a.status !== 'duplicate' || (resolution === 'update' && !stillValidUpdate) || resolution === null) {
    const init = initialResolution(a, s.imp.duplicateStrategy);
    resolution = init.resolution;
    updateTargetId = init.updateTargetId;
  }
  return {
    raw,
    parsed: a.parsed,
    status: a.status,
    messages: a.messages,
    duplicateOf: a.duplicateOf,
    fileDuplicateOf: a.fileDuplicateOf,
    resolution,
    updateTargetId,
  };
}

function withRoleOverride(s: ReviewSession, raw: Record<string, string>, roleId: string | null): Record<string, string> {
  const next = { ...raw };
  const header = s.ctx.mapping.roleHeader ?? RAW_OVERRIDE_KEYS.roleId;
  next[header] = roleId ?? '';
  return next;
}

function withCoordsOverride(s: ReviewSession, raw: Record<string, string>, coords: { lat: number; lon: number } | null): Record<string, string> {
  const next = { ...raw };
  const latKey = s.ctx.mapping.latHeader ?? RAW_OVERRIDE_KEYS.lat;
  const lonKey = s.ctx.mapping.lonHeader ?? RAW_OVERRIDE_KEYS.lon;
  if (coords) {
    next[latKey] = String(coords.lat);
    next[lonKey] = String(coords.lon);
  } else if (s.ctx.mapping.latHeader && s.ctx.mapping.lonHeader) {
    next[latKey] = '';
    next[lonKey] = '';
  } else {
    delete next[latKey];
    delete next[lonKey];
  }
  return next;
}

function acceptLocation(row: Pick<ImportRowRecord, 'parsed' | 'messages' | 'status'>, location: { lat: number; lon: number; geocode: RecordGeocodeInfo }) {
  const { parsed, messages } = applyLocation(row.parsed!, row.messages, location);
  const status = row.status === 'valid' || row.status === 'warning' ? statusFromMessages(messages, false) : row.status;
  return { parsed, messages, status };
}

/** `PATCH /api/imports/:id/rows/:rowNumber` (§8.5 "Revisar"). */
export async function patchRow(
  db: DbOrTx,
  actor: Actor,
  id: string,
  rowNumber: number,
  patch: ImportRowPatch,
  deps: ReviewDeps = {},
): Promise<ImportRowDto> {
  const s = await openSession(db, actor, id, deps);
  const row = await requireRow(db, id, rowNumber);
  let set: Partial<typeof importRows.$inferInsert> = {};
  let raw = row.raw;
  let needsReanalysis = false;

  if (patch.raw) {
    const headers = new Set(Object.keys(row.raw));
    for (const k of Object.keys(patch.raw)) {
      if (!headers.has(k) && !isRawOverrideKey(k)) {
        throw new ValidationError(`La columna "${k}" no existe en el archivo.`);
      }
    }
    raw = { ...raw, ...patch.raw };
    needsReanalysis = true;
  }
  if (patch.roleId !== undefined) {
    raw = withRoleOverride(s, raw, patch.roleId);
    needsReanalysis = true;
  }
  if (patch.lat !== undefined || patch.lon !== undefined) {
    if ((patch.lat == null) !== (patch.lon == null)) {
      throw new ValidationError('Latitud y longitud van juntas: indica las dos o ninguna.');
    }
    raw = withCoordsOverride(s, raw, patch.lat != null && patch.lon != null ? { lat: patch.lat, lon: patch.lon } : null);
    needsReanalysis = true;
  }
  if (patch.acceptSuggestion) {
    if (row.parsed?.suggestedRoleId) {
      raw = withRoleOverride(s, raw, row.parsed.suggestedRoleId);
      needsReanalysis = true;
    } else if (row.parsed?.suggestedLocation) {
      set = { ...set, ...acceptLocation(row, row.parsed.suggestedLocation) };
    } else {
      throw new ValidationError('Esta fila no tiene una sugerencia pendiente.');
    }
  }
  if (patch.candidateIndex !== undefined) {
    const approx = row.messages.find((m) => m.code === 'location_approx');
    const candidates = (approx?.data?.candidates as GeocodeCandidate[] | undefined) ?? [];
    const c = candidates[patch.candidateIndex];
    if (!c) throw new ValidationError('El candidato elegido ya no está disponible.');
    if (c.roleId && s.layer.hasRole && !row.parsed?.roleId) {
      raw = withRoleOverride(s, raw, c.roleId);
      needsReanalysis = true;
    } else {
      const address = s.layer.addressFieldKey ? String(row.parsed?.attributes[s.layer.addressFieldKey] ?? '') : '';
      const provider = String(approx?.data?.provider ?? 'padron');
      set = { ...set, ...acceptLocation(row, { lat: c.lat, lon: c.lon, geocode: { provider, confidence: c.confidence, query: address } }) };
    }
  }
  if (patch.excluded === false && row.status === 'excluded') needsReanalysis = true;

  if (needsReanalysis) {
    set = { ...set, ...(await reanalyze(s, row, raw)) };
  }

  if (patch.excluded === true) {
    set.status = 'excluded';
  }

  if (patch.resolution !== undefined || patch.updateTargetId !== undefined) {
    const current = { ...row, ...set } as ImportRowRecord;
    if (current.status !== 'duplicate') {
      throw new ValidationError('Solo las filas repetidas se pueden omitir, actualizar o crear igual.');
    }
    const resolution = patch.resolution === undefined ? current.resolution : patch.resolution;
    let target = patch.updateTargetId === undefined ? current.updateTargetId : patch.updateTargetId;
    if (resolution === 'update') {
      if (target === null && current.duplicateOf.length === 1) target = current.duplicateOf[0]!;
      if (target === null) {
        throw new ValidationError(
          current.duplicateOf.length === 0
            ? 'Esta fila repite otra fila del archivo; no hay un registro existente que actualizar. Elige "Crear igual" u "Omitir".'
            : 'Hay varios registros existentes con los mismos datos. Elige cuál quieres actualizar.',
        );
      }
      if (!current.duplicateOf.includes(target)) {
        throw new ValidationError('El registro elegido no es uno de los repetidos de esta fila.');
      }
    } else {
      target = null;
    }
    set.resolution = resolution ?? null;
    set.updateTargetId = target;
  }

  if (Object.keys(set).length === 0) {
    const [dto] = await attachExisting(db, [row]);
    return dto!;
  }
  const [updated] = await db
    .update(importRows)
    .set(set)
    .where(and(eq(importRows.importId, id), eq(importRows.rowNumber, rowNumber)))
    .returning();
  const [dto] = await attachExisting(db, [updated!]);
  return dto!;
}

/** `POST /api/imports/:id/rows/bulk`: aplica una acción a todas las filas que calzan con el filtro. */
export async function bulkRows(db: DbOrTx, actor: Actor, id: string, input: ImportRowsBulkInput, deps: ReviewDeps = {}): Promise<{ updated: number }> {
  const s = await openSession(db, actor, id, deps);
  const where = rowsWhere(id, input.filter);

  switch (input.action) {
    case 'skip':
    case 'create': {
      const res = await db
        .update(importRows)
        .set({ resolution: input.action, updateTargetId: null })
        .where(and(where, eq(importRows.status, 'duplicate')))
        .returning({ n: importRows.rowNumber });
      return { updated: res.length };
    }
    case 'update': {
      const res = await db
        .update(importRows)
        .set({
          resolution: 'update',
          updateTargetId: sql`COALESCE(${importRows.updateTargetId}, (${importRows.duplicateOf}->>0)::int)`,
        })
        .where(
          and(
            where,
            eq(importRows.status, 'duplicate'),
            sql`(${importRows.updateTargetId} IS NOT NULL OR (jsonb_array_length(${importRows.duplicateOf}) = 1 AND ${importRows.fileDuplicateOf} IS NULL))`,
          ),
        )
        .returning({ n: importRows.rowNumber });
      return { updated: res.length };
    }
    case 'exclude': {
      const res = await db
        .update(importRows)
        .set({ status: 'excluded' })
        .where(and(where, sql`${importRows.status} <> 'excluded'`))
        .returning({ n: importRows.rowNumber });
      return { updated: res.length };
    }
    case 'include': {
      const rows = await db.select().from(importRows).where(and(where, eq(importRows.status, 'excluded'))).orderBy(asc(importRows.rowNumber));
      for (const row of rows) {
        const set = await reanalyze(s, row, row.raw);
        await db.update(importRows).set(set).where(and(eq(importRows.importId, id), eq(importRows.rowNumber, row.rowNumber)));
      }
      return { updated: rows.length };
    }
    case 'accept_suggestion': {
      const rows = await db
        .select()
        .from(importRows)
        .where(and(where, sql`${importRows.status} <> 'excluded'`, sql`(${importRows.parsed}->'suggestedLocation' IS NOT NULL AND ${importRows.parsed}->'suggestedLocation' <> 'null'::jsonb OR ${importRows.parsed}->>'suggestedRoleId' IS NOT NULL)`))
        .orderBy(asc(importRows.rowNumber));
      let updated = 0;
      for (const row of rows) {
        if (!row.parsed) continue;
        let set: Partial<typeof importRows.$inferInsert>;
        if (row.parsed.suggestedRoleId) {
          set = await reanalyze(s, row, withRoleOverride(s, row.raw, row.parsed.suggestedRoleId));
        } else if (row.parsed.suggestedLocation) {
          set = acceptLocation(row, row.parsed.suggestedLocation);
        } else continue;
        await db.update(importRows).set(set).where(and(eq(importRows.importId, id), eq(importRows.rowNumber, row.rowNumber)));
        updated++;
      }
      return { updated };
    }
  }
}

// ---------- registros que no vienen en el archivo (reemplazo completo) ----------

export async function listRemovals(db: DbOrTx, id: string, q: { page: number; pageSize: number }): Promise<Paginated<ImportRemovalDto>> {
  const imp = await requireImport(db, id);
  const layer = await requireLayer(db, imp.layerId);
  const where = eq(importRemovals.importId, id);
  const [rows, totals] = await Promise.all([
    db
      .select({ removal: importRemovals, record: { id: records.id, roleId: records.roleId, attributes: records.attributes, createdBy: records.createdBy } })
      .from(importRemovals)
      .leftJoin(records, eq(records.id, importRemovals.recordId))
      .where(where)
      .orderBy(asc(importRemovals.recordId))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(importRemovals).where(where),
  ]);
  return {
    data: rows.map((r) => ({
      ...jsonify(r.removal),
      record: r.record?.id
        ? { id: r.record.id, roleId: r.record.roleId, summary: buildSummary(layer.fields, r.record.attributes), createdBy: r.record.createdBy }
        : null,
    })),
    total: Number(totals[0]?.total ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function patchRemovals(db: DbOrTx, actor: Actor, id: string, input: ImportRemovalsPatch): Promise<{ updated: number }> {
  const imp = await requireImport(db, id);
  assertOwnImport(actor, imp);
  requireReview(imp);
  const conds: SQL[] = [eq(importRemovals.importId, id)];
  if (!input.all) conds.push(inArray(importRemovals.recordId, input.recordIds ?? []));
  // Los no borrables se ignoran al marcar "eliminar" (§8.5).
  if (input.resolution === 'delete') conds.push(eq(importRemovals.deletable, true));
  const res = await db
    .update(importRemovals)
    .set({ resolution: input.resolution })
    .where(and(...conds))
    .returning({ id: importRemovals.recordId });
  return { updated: res.length };
}

// ---------- descartar ----------

const DISCARDABLE = new Set<ImportRow['status']>(['UPLOADED', 'ANALYZING', 'REVIEW', 'FAILED']);

export async function discardImport(db: DbOrTx, actor: Actor, id: string): Promise<void> {
  const imp = await requireImport(db, id);
  assertOwnImport(actor, imp);
  if (!DISCARDABLE.has(imp.status)) {
    throw new ConflictError('Solo se pueden descartar borradores. Una importación confirmada se puede revertir desde el historial.');
  }
  await discardRows(db, imp);
}

/** Marca DISCARDED, borra filas y archivo. Compartido con la limpieza diaria. */
export async function discardRows(db: DbOrTx, imp: Pick<ImportRow, 'id' | 'fileKey'>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(importRows).where(eq(importRows.importId, imp.id));
    await tx.delete(importRemovals).where(eq(importRemovals.importId, imp.id));
    await tx.update(imports).set({ status: 'DISCARDED', fileKey: null, progress: {} }).where(eq(imports.id, imp.id));
  });
  if (imp.fileKey) await storage.delete(imp.fileKey);
}

export type { ImportMessage, ParsedRow };
