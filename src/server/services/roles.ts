import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import iconv from 'iconv-lite';
import Papa from 'papaparse';
import type { DbOrTx } from '@/db/client';
import { layers, records, roleOperationRoles, roleOperations, roles } from '@/db/schema';
import { departments } from '@/shared/constants';
import { looksLikeRoleId, normalizeRoleId, tryNormalizeRoleId } from '@/shared/role-id';
import type { UpdateRoleInput } from '@/shared/schemas/roles';
import type {
  BulkImportSummary,
  RoleDto,
  RoleHistory,
  RoleOperationDto,
  RoleRecords,
  RoleRecordsLayerGroup,
} from '@/shared/types';
import type { Actor } from '../auth/session';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { normalizeAddress } from '../geocoding/normalize-address';
import { parseCoordinatePair } from '../parsing/coordinates';
import { buildSummary } from './_shared';
import * as audit from './audit';
import { detachRoleFromRecords, propagatePadronCoordinates, propagateRoleCoordinates } from './coordinates';

export type RoleRow = typeof roles.$inferSelect;

// ---------- lectura ----------

function toDto(row: RoleRow, resultRoleIds?: string[], recordCount?: number): RoleDto {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    vigente: row.supersededAt === null,
    ...(resultRoleIds ? { resultRoleIds } : {}),
    ...(recordCount !== undefined ? { recordCount } : {}),
  };
}

/** Roles resultantes de las operaciones donde `roleId` es origen (para roles no vigentes). */
async function resultRolesOf(db: DbOrTx, roleIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (roleIds.length === 0) return map;
  const rows = await db.execute<{ origin: string; result: string }>(sql`
    SELECT o.role_id AS origin, r.role_id AS result
    FROM role_operation_roles o
    JOIN role_operations op ON op.id = o.operation_id AND op.type <> 'modificacion'
    JOIN role_operation_roles r ON r.operation_id = o.operation_id AND r.side = 'result'
    WHERE o.side = 'origin' AND o.role_id IN ${roleIds}
    ORDER BY op.effective_date, r.role_id
  `);
  for (const row of rows) {
    const list = map.get(row.origin) ?? [];
    if (!list.includes(row.result)) list.push(row.result);
    map.set(row.origin, list);
  }
  return map;
}

export async function getRole(db: DbOrTx, roleId: string): Promise<RoleDto> {
  const id = normalizeRoleId(roleId);
  if (!id) throw new NotFoundError('El rol no existe');
  const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!row) throw new NotFoundError(`El rol ${id} no está registrado`);
  const [results, [{ n } = { n: 0 }]] = await Promise.all([
    resultRolesOf(db, [id]),
    db.select({ n: sql<number>`count(*)::int` }).from(records).where(eq(records.roleId, id)),
  ]);
  return toDto(row, results.get(id) ?? [], Number(n));
}

/** Prefijo sobre `id` (normalizando si parece rol) y similitud trigram sobre `address_norm` (§7.4). */
export async function searchRoles(db: DbOrTx, q: string, limit = 8): Promise<RoleDto[]> {
  const term = q.trim();
  if (!term) return [];
  const found: RoleRow[] = [];

  if (looksLikeRoleId(term)) {
    // Prefijo por partes: "50-1" → '00050-00001%'; "50" → '00050-%' además de '50%'
    const m = /^(\d{1,5})(?:\s*[-–—/]\s*(\d{0,5}))?$/.exec(term);
    const patterns: string[] = [];
    if (m) {
      const left = m[1]!.padStart(5, '0');
      if (m[2] !== undefined) {
        patterns.push(`${left}-${m[2]}%`);
        if (m[2].length > 0) patterns.push(`${left}-${m[2].padStart(5, '0')}`);
      } else {
        patterns.push(`${left}-%`);
        patterns.push(`${m[1]}%`);
      }
    }
    const rows = await db
      .select()
      .from(roles)
      .where(or(...patterns.map((p) => ilike(roles.id, p))))
      .orderBy(asc(roles.id))
      .limit(limit);
    found.push(...rows);
  }

  if (found.length < limit) {
    const norm = normalizeAddress(term).addressNorm;
    if (norm.length >= 3) {
      const remaining = limit - found.length;
      const rows = await db.execute<RoleRow & { sim: number }>(sql`
        SELECT *, similarity(address_norm, ${norm}) AS sim
        FROM roles
        WHERE address_norm % ${norm} OR address_norm ILIKE ${`%${norm}%`}
        ORDER BY (address_norm ILIKE ${`${norm}%`}) DESC, sim DESC, id
        LIMIT ${remaining}
      `);
      for (const r of rows) {
        if (!found.some((f) => f.id === r.id)) found.push(normalizeRow(r));
      }
    }
  }

  const results = await resultRolesOf(
    db,
    found.filter((r) => r.supersededAt !== null).map((r) => r.id),
  );
  return found.map((r) => toDto(r, results.get(r.id) ?? []));
}

/** Las filas de `db.execute` traen snake_case y fechas como string: las normalizamos a `RoleRow`. */
function normalizeRow(r: Record<string, unknown>): RoleRow {
  return {
    id: String(r.id),
    lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
    lon: r.lon === null || r.lon === undefined ? null : Number(r.lon),
    address: (r.address as string | null) ?? null,
    addressNorm: (r.address_norm as string | null) ?? null,
    streetNorm: (r.street_norm as string | null) ?? null,
    houseNumber: r.house_number === null || r.house_number === undefined ? null : Number(r.house_number),
    supersededAt: (r.superseded_at as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

// ---------- escritura ----------

/** Crea el rol si no existe (sin coordenadas). Devuelve la fila actual. */
export async function ensureRole(tx: DbOrTx, roleId: string): Promise<RoleRow> {
  await tx.insert(roles).values({ id: roleId }).onConflictDoNothing();
  const [row] = await tx.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  return row!;
}

export async function ensureRoles(tx: DbOrTx, roleIds: string[]): Promise<void> {
  const unique = [...new Set(roleIds)];
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    await tx
      .insert(roles)
      .values(chunk.map((id) => ({ id })))
      .onConflictDoNothing();
  }
}

export async function updateRole(db: DbOrTx, actor: Actor, roleId: string, patch: UpdateRoleInput): Promise<RoleDto> {
  const id = normalizeRoleId(roleId);
  if (!id) throw new NotFoundError('El rol no existe');
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!before) throw new NotFoundError(`El rol ${id} no está registrado`);

    const set: Partial<typeof roles.$inferInsert> = {};
    if (patch.address !== undefined) {
      set.address = patch.address;
      const n = normalizeAddress(patch.address);
      set.addressNorm = n.addressNorm || null;
      set.streetNorm = n.streetNorm;
      set.houseNumber = n.houseNumber;
    }
    const coordsChanged = patch.lat !== undefined && patch.lon !== undefined;
    if (coordsChanged) {
      set.lat = patch.lat;
      set.lon = patch.lon;
    }
    if (Object.keys(set).length === 0) return toDto(before);

    const [after] = await tx.update(roles).set(set).where(eq(roles.id, id)).returning();
    let propagated = 0;
    if (coordsChanged && patch.lat != null && patch.lon != null) {
      propagated = await propagateRoleCoordinates(tx, id, patch.lat, patch.lon);
    }
    await audit.log(tx, {
      actor,
      action: 'UPDATE',
      entityType: 'ROLE',
      entityId: id,
      metadata: {
        before: { lat: before.lat, lon: before.lon, address: before.address },
        after: { lat: after!.lat, lon: after!.lon, address: after!.address },
        propagatedRecords: propagated,
      },
    });
    return toDto(after!);
  });
}

/** Borra un rol (§7.4): Conflict si participa en operaciones; sus registros quedan sin rol con coordenadas propias. */
export async function deleteRole(db: DbOrTx, actor: Actor, roleId: string): Promise<void> {
  const id = normalizeRoleId(roleId);
  if (!id) throw new NotFoundError('El rol no existe');
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!row) throw new NotFoundError(`El rol ${id} no está registrado`);
    const [op] = await tx
      .select({ operationId: roleOperationRoles.operationId })
      .from(roleOperationRoles)
      .where(eq(roleOperationRoles.roleId, id))
      .limit(1);
    if (op) {
      throw new ConflictError(
        `El rol ${id} participa en una subdivisión, fusión u otra operación registrada. Elimina primero esa operación.`,
      );
    }
    await detachRoleFromRecords(tx, id);
    const affected = await tx.select({ id: records.id }).from(records).where(eq(records.roleId, id));
    await tx.delete(roles).where(eq(roles.id, id));
    await audit.log(tx, {
      actor,
      action: 'DELETE',
      entityType: 'ROLE',
      entityId: id,
      metadata: { address: row.address, detachedRecords: affected.length },
    });
  });
}

// ---------- historial (§8.9) ----------

async function loadOperationsByIds(db: DbOrTx, ids: number[]): Promise<RoleOperationDto[]> {
  if (ids.length === 0) return [];
  const [ops, links, recs] = await Promise.all([
    db.select().from(roleOperations).where(inArray(roleOperations.id, ids)).orderBy(asc(roleOperations.effectiveDate), asc(roleOperations.id)),
    db.select().from(roleOperationRoles).where(inArray(roleOperationRoles.operationId, ids)),
    db
      .select({
        id: records.id,
        layerId: records.layerId,
        attributes: records.attributes,
        layerName: layers.name,
        fields: layers.fields,
        opId: roleOperations.id,
      })
      .from(roleOperations)
      .innerJoin(records, eq(records.id, roleOperations.recordId))
      .innerJoin(layers, eq(layers.id, records.layerId))
      .where(inArray(roleOperations.id, ids)),
  ]);
  const recByOp = new Map(recs.map((r) => [r.opId, r]));
  return ops.map((op) => {
    const rec = recByOp.get(op.id);
    return {
      ...op,
      createdAt: op.createdAt.toISOString(),
      originRoleIds: links.filter((l) => l.operationId === op.id && l.side === 'origin').map((l) => l.roleId).sort(),
      resultRoleIds: links.filter((l) => l.operationId === op.id && l.side === 'result').map((l) => l.roleId).sort(),
      record: rec
        ? { id: rec.id, layerId: rec.layerId, layerName: rec.layerName, summary: buildSummary(rec.fields, rec.attributes) }
        : null,
    };
  });
}

export async function getOperationsForRoles(db: DbOrTx, roleIds: string[]): Promise<RoleOperationDto[]> {
  if (roleIds.length === 0) return [];
  const links = await db
    .select({ operationId: roleOperationRoles.operationId })
    .from(roleOperationRoles)
    .where(inArray(roleOperationRoles.roleId, roleIds));
  return loadOperationsByIds(db, [...new Set(links.map((l) => l.operationId))]);
}

async function lineage(db: DbOrTx, roleId: string, direction: 'ancestors' | 'descendants'): Promise<string[]> {
  const [from, to] = direction === 'ancestors' ? ['result', 'origin'] : ['origin', 'result'];
  const rows = await db.execute<{ role_id: string }>(sql`
    WITH RECURSIVE chain AS (
      SELECT o.role_id, 1 AS depth
      FROM role_operation_roles r
      JOIN role_operations op ON op.id = r.operation_id AND op.type <> 'modificacion'
      JOIN role_operation_roles o ON o.operation_id = r.operation_id AND o.side = ${to}::role_operation_side
      WHERE r.role_id = ${roleId} AND r.side = ${from}::role_operation_side
      UNION
      SELECT o.role_id, c.depth + 1
      FROM chain c
      JOIN role_operation_roles r ON r.role_id = c.role_id AND r.side = ${from}::role_operation_side
      JOIN role_operations op ON op.id = r.operation_id AND op.type <> 'modificacion'
      JOIN role_operation_roles o ON o.operation_id = r.operation_id AND o.side = ${to}::role_operation_side
      WHERE c.depth < 20
    )
    SELECT DISTINCT role_id FROM chain WHERE role_id <> ${roleId} ORDER BY role_id
  `);
  return rows.map((r) => r.role_id);
}

export async function getRoleHistory(db: DbOrTx, roleId: string): Promise<RoleHistory> {
  const [operations, ancestors, descendants] = await Promise.all([
    getOperationsForRoles(db, [roleId]),
    lineage(db, roleId, 'ancestors'),
    lineage(db, roleId, 'descendants'),
  ]);
  return { operations, ancestors, descendants };
}

// ---------- ficha del rol (§7.4) ----------

export async function getRoleRecords(db: DbOrTx, roleId: string, opts: { includeLineage?: boolean } = {}): Promise<RoleRecords> {
  const role = await getRole(db, roleId);
  const history = await getRoleHistory(db, role.id);
  const roleIds = opts.includeLineage ? [role.id, ...history.ancestors] : [role.id];

  const rows = await db
    .select({
      id: records.id,
      roleId: records.roleId,
      lat: records.lat,
      lon: records.lon,
      coordsSource: records.coordsSource,
      attributes: records.attributes,
      updatedAt: records.updatedAt,
      layerId: layers.id,
      layerName: layers.name,
      icon: layers.icon,
      iconColor: layers.iconColor,
      department: layers.department,
      sortOrder: layers.sortOrder,
      fields: layers.fields,
    })
    .from(records)
    .innerJoin(layers, eq(layers.id, records.layerId))
    .where(inArray(records.roleId, roleIds))
    .orderBy(asc(layers.sortOrder), asc(layers.name), desc(records.updatedAt));

  const byDept = new Map<string, Map<number, RoleRecordsLayerGroup>>();
  for (const r of rows) {
    const dept = byDept.get(r.department) ?? new Map<number, RoleRecordsLayerGroup>();
    const group =
      dept.get(r.layerId) ??
      ({ layerId: r.layerId, layerName: r.layerName, icon: r.icon, iconColor: r.iconColor, records: [] } satisfies RoleRecordsLayerGroup);
    group.records.push({
      id: r.id,
      roleId: r.roleId,
      summary: buildSummary(r.fields, r.attributes),
      updatedAt: r.updatedAt.toISOString(),
      hasCoordinates: r.lat !== null && r.lon !== null,
      lat: r.lat,
      lon: r.lon,
      coordsSource: r.coordsSource,
    });
    dept.set(r.layerId, group);
    byDept.set(r.department, dept);
  }

  const groups = departments
    .filter((d) => byDept.has(d))
    .map((d) => ({ department: d, layers: [...byDept.get(d)!.values()] }));

  const layerIds = new Set(rows.map((r) => r.layerId));
  return { role, history, total: rows.length, layerCount: layerIds.size, groups };
}

// ---------- padrón de roles (§7.4) ----------

const PADRON_ALIASES: Record<string, string> = {
  roleid: 'roleId',
  rol: 'roleId',
  'rol sii': 'roleId',
  rol_sii: 'roleId',
  role: 'roleId',
  direccion: 'DIRECCION',
  dirección: 'DIRECCION',
  address: 'DIRECCION',
  complemento: 'COMPLEMENTO',
  lat: 'lat',
  latitud: 'lat',
  latitude: 'lat',
  lon: 'lon',
  lng: 'lon',
  longitud: 'lon',
  longitude: 'lon',
};

function decodeCsv(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  // Windows-1252 (Excel antiguo)
  return iconv.decode(buffer, 'win1252');
}

/**
 * Importa el padrón (CLI o admin). Columnas requeridas `roleId`, `lat`, `lon`; opcionales `DIRECCION`, `COMPLEMENTO`.
 * Upsert en lotes de 1000, luego propaga coordenadas a los registros no 'own'. Nunca borra roles ni cambia vigencia.
 */
export async function importRoleCoordinates(
  db: DbOrTx,
  actor: Pick<Actor, 'userId' | 'email'>,
  buffer: Buffer,
  opts: { fileName?: string } = {},
): Promise<BulkImportSummary> {
  const text = decodeCsv(buffer);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter: '',
    delimitersToGuess: [';', ',', '\t', '|'],
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const map = new Map<string, string>();
  for (const h of headers) {
    const canonical = PADRON_ALIASES[h.toLowerCase()];
    if (canonical) map.set(canonical, h);
  }
  for (const req of ['roleId', 'lat', 'lon']) {
    if (!map.has(req)) throw new ValidationError(`El CSV del padrón no tiene la columna "${req}". Columnas encontradas: ${headers.join(', ')}`);
  }

  type Upsert = typeof roles.$inferInsert;
  const upserts = new Map<string, Upsert>();
  const invalidRows: BulkImportSummary['invalidRows'] = [];

  parsed.data.forEach((row, i) => {
    const rowNumber = i + 2;
    const r = tryNormalizeRoleId(row[map.get('roleId')!]);
    if (!r.ok || !r.value) {
      invalidRows.push({ rowNumber, message: r.ok ? 'Rol vacío' : r.error });
      return;
    }
    const pair = parseCoordinatePair(row[map.get('lat')!], row[map.get('lon')!]);
    if (!pair.ok) {
      invalidRows.push({ rowNumber, message: pair.error });
      return;
    }
    const dir = map.has('DIRECCION') ? (row[map.get('DIRECCION')!] ?? '').trim() : '';
    const comp = map.has('COMPLEMENTO') ? (row[map.get('COMPLEMENTO')!] ?? '').trim() : '';
    const address = [dir, comp].filter(Boolean).join(' ') || null;
    const n = normalizeAddress(address);
    upserts.set(r.value, {
      id: r.value,
      lat: pair.lat,
      lon: pair.lon,
      address,
      addressNorm: address ? n.addressNorm || null : null,
      streetNorm: address ? n.streetNorm : null,
      houseNumber: address ? n.houseNumber : null,
    });
  });

  const values = [...upserts.values()];
  let updatedRecords = 0;

  await db.transaction(async (tx) => {
    for (let i = 0; i < values.length; i += 1000) {
      const chunk = values.slice(i, i + 1000);
      await tx
        .insert(roles)
        .values(chunk)
        .onConflictDoUpdate({
          target: roles.id,
          set: {
            lat: sql`COALESCE(EXCLUDED.lat, ${roles.lat})`,
            lon: sql`COALESCE(EXCLUDED.lon, ${roles.lon})`,
            address: sql`COALESCE(EXCLUDED.address, ${roles.address})`,
            addressNorm: sql`COALESCE(EXCLUDED.address_norm, ${roles.addressNorm})`,
            streetNorm: sql`COALESCE(EXCLUDED.street_norm, ${roles.streetNorm})`,
            houseNumber: sql`COALESCE(EXCLUDED.house_number, ${roles.houseNumber})`,
            updatedAt: sql`now()`,
          },
        });
    }
    const withCoords = values.filter((v) => v.lat !== null).map((v) => v.id);
    for (let i = 0; i < withCoords.length; i += 5000) {
      updatedRecords += await propagatePadronCoordinates(tx, withCoords.slice(i, i + 5000));
    }
    await audit.log(tx, {
      actor,
      action: 'IMPORT',
      entityType: 'ROLE',
      entityId: 'padron',
      metadata: {
        fileName: opts.fileName ?? null,
        totalRows: parsed.data.length,
        upsertedRoles: values.length,
        invalidRows: invalidRows.length,
        updatedRecords,
      },
    });
  });

  // Roles vigentes del sistema que no vienen en el padrón (pista de operaciones pendientes)
  const missing = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.supersededAt), sql`${roles.id} <> ALL(${sql.raw(`ARRAY[${values.map((v) => `'${v.id}'`).join(',') || "''"}]::varchar[]`)})`))
    .orderBy(asc(roles.id))
    .limit(5000);

  return {
    totalRows: parsed.data.length,
    upsertedRoles: values.length,
    updatedRecords,
    invalidRows,
    missingFromPadron: missing.map((m) => m.id),
  };
}
