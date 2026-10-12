/**
 * Utilidades compartidas por los tests de servicios (BD real, §13 "Tests con base de datos real").
 *
 * - `setupDbSuite()` toma un advisory lock de PostgreSQL durante todo el archivo: los archivos de test que
 *   comparten la misma base se ejecutan uno tras otro aunque Vitest los corra en workers paralelos.
 * - `truncateAll()` deja la base vacía antes de cada test.
 * - Fábricas mínimas para capas, roles y registros (inserción directa, sin reglas de negocio).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { db, sqlClient } from '@/db/client';
import { layers, records, roles } from '@/db/schema';
import type { Actor } from '@/server/auth/session';
import { createGeocoder, setGeocoder } from '@/server/geocoding';
import { normalizeAddress } from '@/server/geocoding/normalize-address';
import type { CoordsSource, Department } from '@/shared/constants';
import type { RecordGeocodeInfo } from '@/shared/schemas/geocode';
import type { LayerField } from '@/shared/schemas/layers';
import { slugify } from '@/shared/text';

export { db };

export const admin: Actor = { userId: 't', email: 't@t', name: 'T', role: 'admin', rawRole: 'admin', mustChangePassword: false };
export const editor: Actor = { userId: 'e', email: 'e@t', name: 'E', role: 'editor', rawRole: 'editor', mustChangePassword: false };
export const viewer: Actor = { userId: 'v', email: 'v@t', name: 'V', role: 'viewer', rawRole: 'viewer', mustChangePassword: false };

const TABLES = [
  'records',
  'roles',
  'layers',
  'layer_counters',
  'role_operations',
  'role_operation_roles',
  'geocode_cache',
  'audit_logs',
  'attachments',
  // dependen de layers/records: truncarlas explícitamente evita los NOTICE de "truncate cascades"
  'imports',
  'import_rows',
  'import_removals',
  'file_blobs',
] as const;

export async function truncateAll(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
}

const SUITE_LOCK_KEY = 7_311_002;

/**
 * Serializa los archivos de test sobre la misma base (advisory lock por sesión dedicada) y trunca antes de cada test.
 * También fija el geocodificador de la app al proveedor local `padron` para que ningún test salga a internet.
 */
export function setupDbSuite(opts: { truncate?: boolean } = {}): void {
  let lockConn: Awaited<ReturnType<typeof sqlClient.reserve>> | null = null;

  beforeAll(async () => {
    lockConn = await sqlClient.reserve();
    await lockConn`SELECT pg_advisory_lock(${SUITE_LOCK_KEY})`;
    setGeocoder(createGeocoder(db, { providers: ['padron'] }));
  });

  afterAll(async () => {
    setGeocoder(null);
    if (lockConn) {
      await lockConn`SELECT pg_advisory_unlock(${SUITE_LOCK_KEY})`;
      lockConn.release();
      lockConn = null;
    }
  });

  if (opts.truncate !== false) {
    beforeEach(async () => {
      await truncateAll();
    });
  }
}

// ---------- fábricas ----------

type LayerOverrides = Partial<Omit<typeof layers.$inferInsert, 'fields'>> & { fields?: LayerField[] };

export const field = (key: string, label: string, type: LayerField['type'] = 'string', extra: Partial<LayerField> = {}): LayerField => ({
  key,
  label,
  type,
  required: false,
  options: {},
  ...extra,
});

let layerSeq = 0;

export async function createLayer(overrides: LayerOverrides = {}) {
  layerSeq += 1;
  const name = overrides.name ?? `Capa ${layerSeq}`;
  const [row] = await db
    .insert(layers)
    .values({
      name,
      slug: overrides.slug ?? `${slugify(name)}-${layerSeq}-${Date.now()}`,
      department: (overrides.department ?? 'edificacion') as Department,
      hasRole: overrides.hasRole ?? true,
      fields: overrides.fields ?? [field('n_permiso', 'N° Permiso', 'number'), field('direccion', 'Dirección'), field('obs', 'Observaciones')],
      uniqueKeys: overrides.uniqueKeys ?? [],
      addressFieldKey: overrides.addressFieldKey ?? null,
      heatmapFieldKey: overrides.heatmapFieldKey ?? null,
      icon: overrides.icon ?? 'building-2',
      iconColor: overrides.iconColor ?? '#3b82f6',
      sortOrder: overrides.sortOrder ?? layerSeq,
    })
    .returning();
  return row!;
}

export async function createRole(id: string, opts: { lat?: number | null; lon?: number | null; address?: string | null; supersededAt?: string | null } = {}) {
  const n = normalizeAddress(opts.address ?? null);
  const [row] = await db
    .insert(roles)
    .values({
      id,
      lat: opts.lat ?? null,
      lon: opts.lon ?? null,
      address: opts.address ?? null,
      addressNorm: opts.address ? n.addressNorm || null : null,
      streetNorm: opts.address ? n.streetNorm : null,
      houseNumber: opts.address ? n.houseNumber : null,
      supersededAt: opts.supersededAt ?? null,
    })
    .returning();
  return row!;
}

type RecordInsert = {
  layerId: number;
  roleId?: string | null;
  lat?: number | null;
  lon?: number | null;
  coordsSource?: CoordsSource | null;
  geocode?: RecordGeocodeInfo | null;
  attributes?: Record<string, unknown>;
  comments?: string | null;
  numberAssignedAt?: Date | null;
};

/** Inserción directa (sin reglas 8.3/8.4): para preparar escenarios. */
export async function insertRecord(input: RecordInsert) {
  const hasCoords = input.lat !== undefined && input.lat !== null && input.lon !== undefined && input.lon !== null;
  const [row] = await db
    .insert(records)
    .values({
      layerId: input.layerId,
      roleId: input.roleId ?? null,
      lat: hasCoords ? input.lat : null,
      lon: hasCoords ? input.lon : null,
      coordsSource: hasCoords ? (input.coordsSource ?? (input.roleId ? 'role' : 'own')) : null,
      geocode: input.geocode ?? null,
      attributes: input.attributes ?? {},
      comments: input.comments ?? null,
      numberAssignedAt: input.numberAssignedAt ?? null,
      numberAssignedBy: input.numberAssignedAt ? 't' : null,
      createdBy: 't',
      updatedBy: 't',
    })
    .returning();
  return row!;
}

export async function insertRecords(inputs: RecordInsert[], chunk = 1000): Promise<number> {
  let n = 0;
  for (let i = 0; i < inputs.length; i += chunk) {
    const part = inputs.slice(i, i + chunk).map((input) => {
      const hasCoords = input.lat != null && input.lon != null;
      return {
        layerId: input.layerId,
        roleId: input.roleId ?? null,
        lat: hasCoords ? input.lat : null,
        lon: hasCoords ? input.lon : null,
        coordsSource: hasCoords ? (input.coordsSource ?? (input.roleId ? ('role' as const) : ('own' as const))) : null,
        geocode: input.geocode ?? null,
        attributes: input.attributes ?? {},
        comments: input.comments ?? null,
        createdBy: 't',
        updatedBy: 't',
      };
    });
    await db.insert(records).values(part);
    n += part.length;
  }
  return n;
}

export async function getRecordRow(id: number) {
  const [row] = await db
    .select({
      id: records.id,
      layerId: records.layerId,
      roleId: records.roleId,
      lat: records.lat,
      lon: records.lon,
      coordsSource: records.coordsSource,
      geocode: records.geocode,
      attributes: records.attributes,
      comments: records.comments,
      numberAssignedAt: records.numberAssignedAt,
    })
    .from(records)
    .where(sql`${records.id} = ${id}`)
    .limit(1);
  return row ?? null;
}

export async function getRoleRow(id: string) {
  const [row] = await db.select().from(roles).where(sql`${roles.id} = ${id}`).limit(1);
  return row ?? null;
}

/** Coordenadas dentro de la comuna de El Bosque (§0). */
export const IN_COMUNA = { lat: -33.5606, lon: -70.6614 } as const;
export const IN_COMUNA_2 = { lat: -33.5650, lon: -70.6700 } as const;
export const OUT_OF_COMUNA = { lat: -33.4372, lon: -70.6506 } as const; // Santiago centro

/** Lee un ReadableStream completo como texto. */
export async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(merged);
}
