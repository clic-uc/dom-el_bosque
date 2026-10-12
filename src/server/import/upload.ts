import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { imports } from '@/db/schema';
import { env } from '@/env';
import { IMPORT_DRAFT_TTL_DAYS } from '@/shared/constants';
import { ROLE_HEADER_ALIASES } from '@/shared/role-id';
import type { ImportSourcePatch } from '@/shared/schemas/imports';
import { MAPPING_TARGETS } from '@/shared/schemas/imports';
import { capabilities } from '@/shared/capabilities';
import { normalizeText, toFieldKey } from '@/shared/text';
import type { ImportSource } from '@/shared/types';
import type { Actor } from '../auth/session';
import { ConflictError, ValidationError } from '../errors';
import { requireLayer, type LayerRow } from '../services/_shared';
import { cleanupWithoutWorker } from '../jobs/inline';
import { storage } from '../storage';
import { assertOwnImport, requireImport } from './service';
import { importFileKey, parseImportBuffer, readImportTable, type ImportRow } from './source';
import type { ParsedTable } from './table';

export type UploadFile = { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };

const LAT_ALIASES = new Set(['lat', 'latitud', 'latitude', 'y']);
const LON_ALIASES = new Set(['lon', 'lng', 'long', 'longitud', 'longitude', 'x']);
const COMMENT_ALIASES = new Set([
  'comentarios',
  'comentario',
  'observaciones',
  'observacion',
  'comments',
  'notas',
]);

/** Auto-mapeo por nombre, case/acento-insensible, por label y por key de los campos (§10.2 paso 2). */
export function buildSuggestedMapping(
  headers: string[],
  layer: Pick<LayerRow, 'hasRole' | 'fields'>,
): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();
  const byLabel = new Map(layer.fields.map((f) => [normalizeText(f.label), f.key]));
  const byKey = new Map(layer.fields.map((f) => [f.key, f.key]));

  const take = (header: string, target: string | null) => {
    if (target && used.has(target)) target = null;
    mapping[header] = target;
    if (target) used.add(target);
  };

  for (const header of headers) {
    const norm = normalizeText(header);
    const asKey = toFieldKey(header);
    const field = byLabel.get(norm) ?? byKey.get(norm) ?? byKey.get(asKey) ?? null;
    if (field) {
      take(header, field);
      continue;
    }
    if (layer.hasRole && ROLE_HEADER_ALIASES.includes(norm)) {
      take(header, MAPPING_TARGETS.roleId);
      continue;
    }
    if (LAT_ALIASES.has(norm)) {
      take(header, MAPPING_TARGETS.lat);
      continue;
    }
    if (LON_ALIASES.has(norm)) {
      take(header, MAPPING_TARGETS.lon);
      continue;
    }
    if (COMMENT_ALIASES.has(norm)) {
      take(header, MAPPING_TARGETS.comments);
      continue;
    }
    mapping[header] = null;
  }
  return mapping;
}

function toImportSource(imp: ImportRow, table: ParsedTable, layer: LayerRow): ImportSource {
  return {
    importId: imp.id,
    fileType: imp.fileType as 'csv' | 'xlsx',
    sheets: table.sheets,
    sheetName: imp.sheetName,
    headerRow: imp.headerRow,
    delimiter: imp.delimiter,
    headers: table.headers,
    totalRows: table.totalRows,
    preview: table.rows.slice(0, 20),
    suggestedMapping: buildSuggestedMapping(table.headers, layer),
    layer: {
      id: layer.id,
      name: layer.name,
      hasRole: layer.hasRole,
      fields: layer.fields,
      uniqueKeys: layer.uniqueKeys,
      addressFieldKey: layer.addressFieldKey,
    },
  };
}

function fileTypeOf(name: string): 'csv' | 'xlsx' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'xls') {
    throw new ValidationError(
      'Los archivos .xls (Excel antiguo) no se aceptan. Ábrelo en Excel y guárdalo como .xlsx.',
    );
  }
  throw new ValidationError('Solo se aceptan archivos .csv o .xlsx (Excel).');
}

/** Tope de MB efectivo: el del despliegue (staging) o el configurado en el servidor. */
function importMaxMb(): number {
  return capabilities.importMaxMb ?? env.MAX_IMPORT_FILE_MB;
}

/** Staging: rechaza planillas con más filas que el máximo del ambiente (se aplica al subir y al cambiar de hoja). */
export function assertImportRowLimit(totalRows: number): void {
  const max = capabilities.importMaxRows;
  if (max === null || totalRows <= max) return;
  throw new ValidationError(
    `La planilla tiene ${totalRows.toLocaleString('es-CL')} filas con datos y en este ambiente de pruebas se aceptan hasta ${max.toLocaleString('es-CL')}. Divide la planilla en partes más pequeñas e impórtalas una por una.`,
    { totalRows, maxRows: max },
  );
}

/**
 * Subir (§8.5): valida tipo, tamaño y filas, guarda el archivo en storage, crea la importación en UPLOADED
 * (vence a los 7 días) y devuelve la vista previa con el mapeo sugerido. El archivo se lee antes de guardarlo:
 * uno ilegible o demasiado grande no deja nada en storage.
 */
export async function uploadImport(
  db: DbOrTx,
  actor: Actor,
  layerId: number,
  file: UploadFile,
): Promise<ImportSource> {
  const layer = await requireLayer(db, layerId);
  const fileType = fileTypeOf(file.name);
  const maxMb = importMaxMb();
  if (file.size <= 0) throw new ValidationError('El archivo está vacío.');
  if (file.size > maxMb * 1024 * 1024) {
    throw new ValidationError(
      `El archivo pesa más de ${maxMb} MB. Divide la planilla en partes más pequeñas.`,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const table = await parseImportBuffer(
    buffer,
    { fileType, sheetName: null, headerRow: 1, delimiter: null },
    { headerRow: null },
  );
  assertImportRowLimit(table.totalRows);

  // Sin worker no corre la limpieza diaria de borradores vencidos: se aprovecha cada subida.
  await cleanupWithoutWorker();

  const id = randomUUID();
  const fileKey = importFileKey(id);
  await storage.put(fileKey, buffer);

  const expiresAt = new Date(Date.now() + IMPORT_DRAFT_TTL_DAYS * 86_400_000);
  const [row] = await db
    .insert(imports)
    .values({
      id,
      layerId: layer.id,
      userId: actor.userId,
      userEmail: actor.email,
      fileName: file.name.slice(0, 500),
      fileType,
      fileKey,
      sheetName: table.sheetName ?? null,
      headerRow: table.headerRow,
      delimiter: table.delimiter ?? null,
      status: 'UPLOADED',
      totalRows: table.totalRows,
      expiresAt,
    })
    .returning();

  return toImportSource(row!, table, layer);
}

/** `PATCH /api/imports/:id` (§8.5 paso 4): vuelve a leer con otra hoja, fila de encabezados o delimitador. */
export async function patchImportSource(
  db: DbOrTx,
  actor: Actor,
  id: string,
  patch: ImportSourcePatch,
): Promise<ImportSource> {
  const imp = await requireImport(db, id);
  assertOwnImport(actor, imp);
  if (imp.status !== 'UPLOADED') {
    throw new ConflictError(
      'Esta importación ya fue analizada. Para cambiar la hoja o los encabezados, descártala y vuelve a subir el archivo.',
    );
  }
  const layer = await requireLayer(db, imp.layerId);

  const sheetChanged = patch.sheetName !== undefined && patch.sheetName !== imp.sheetName;
  // Al cambiar de hoja, la fila de encabezados se vuelve a detectar salvo que venga explícita.
  const headerRow = patch.headerRow ?? (sheetChanged ? null : imp.headerRow);
  const table = await readImportTable(imp, {
    sheetName: patch.sheetName ?? imp.sheetName,
    headerRow,
    delimiter: patch.delimiter ?? imp.delimiter,
  });
  assertImportRowLimit(table.totalRows);

  const [row] = await db
    .update(imports)
    .set({
      sheetName: table.sheetName ?? imp.sheetName,
      headerRow: table.headerRow,
      delimiter: patch.delimiter ?? table.delimiter ?? imp.delimiter,
      totalRows: table.totalRows,
    })
    .where(eq(imports.id, id))
    .returning();

  return toImportSource(row!, table, layer);
}

/** Vista previa con las opciones actuales (para retomar un borrador en el asistente). */
export async function getImportSource(db: DbOrTx, imp: ImportRow, layer: LayerRow): Promise<ImportSource> {
  const table = await readImportTable(imp);
  return toImportSource(imp, table, layer);
}
