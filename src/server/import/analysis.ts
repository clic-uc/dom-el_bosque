import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { importRows, records, roles } from '@/db/schema';
import { geocodeConfidenceLabels } from '@/shared/constants';
import { tryNormalizeRoleId } from '@/shared/role-id';
import type { GeocodeCandidate, GeocodeResult, RecordGeocodeInfo } from '@/shared/schemas/geocode';
import type { ImportMessage } from '@/shared/schemas/import-rows';
import type { ParsedRow } from '@/shared/schemas/import-rows';
import {
  MAPPING_TARGETS,
  specialMappingTargets,
  type AnalyzeImportData,
  type ImportRowStatus,
} from '@/shared/schemas/imports';
import type { LayerField } from '@/shared/schemas/layers';
import { ValidationError } from '../errors';
import { getGeocoder, type Geocoder } from '../geocoding';
import { normalizeAddress } from '../geocoding/normalize-address';
import { parseCoordinatePair } from '../parsing/coordinates';
import { castAttributes, isEmptyValue } from '../parsing/values';
import { normalizeIdentitySql, normalizeIdentityValue, type LayerRow } from '../services/_shared';
import { resolveCoordinatesForNew } from '../services/coordinates';
import {
  buildIdentity,
  describeIdentity,
  findDuplicateIds,
  layerDetectsDuplicates,
  loadIdentityIndex,
  type Identity,
} from '../services/duplicates';
import { batchGeocodeLocal } from './padron-batch';
import type { TableRow } from './table';

/**
 * Motor de análisis de filas (§8.5 paso 2). `analyzeRow` es puro respecto de la BD: todo lo que necesita
 * (roles, geocodificador, duplicados) lo recibe por el `AnalysisContext`, que tiene dos sabores:
 *  - en bloque (`createBulkContext`): índices en memoria para analizar 40k filas sin consultas por fila;
 *  - incremental (`createIncrementalContext`): consultas puntuales para re-analizar una fila corregida.
 */

// ---------- mapeo ----------

export type ResolvedMapping = {
  roleHeader: string | null;
  latHeader: string | null;
  lonHeader: string | null;
  commentsHeader: string | null;
  fields: { header: string; field: LayerField }[];
};

export function resolveMapping(
  layer: Pick<LayerRow, 'fields'>,
  columnMapping: Record<string, string | null>,
): ResolvedMapping {
  const byKey = new Map(layer.fields.map((f) => [f.key, f]));
  const out: ResolvedMapping = {
    roleHeader: null,
    latHeader: null,
    lonHeader: null,
    commentsHeader: null,
    fields: [],
  };
  for (const [header, target] of Object.entries(columnMapping)) {
    if (!target) continue;
    if (target === MAPPING_TARGETS.roleId) out.roleHeader = header;
    else if (target === MAPPING_TARGETS.lat) out.latHeader = header;
    else if (target === MAPPING_TARGETS.lon) out.lonHeader = header;
    else if (target === MAPPING_TARGETS.comments) out.commentsHeader = header;
    else {
      const field = byKey.get(target);
      if (field) out.fields.push({ header, field });
    }
  }
  return out;
}

/** Validación del mapeo (§8.5 "Analizar" paso 1) con mensajes para mostrar tal cual en la UI. */
export function validateMapping(
  layer: LayerRow,
  input: AnalyzeImportData,
  headers?: string[],
): ResolvedMapping {
  const byKey = new Map(layer.fields.map((f) => [f.key, f]));
  const seen = new Map<string, string>();
  const headerSet = headers ? new Set(headers) : null;

  for (const [header, target] of Object.entries(input.columnMapping)) {
    if (headerSet && !headerSet.has(header)) {
      throw new ValidationError(`La columna "${header}" no existe en el archivo. Vuelve a revisar el mapeo.`);
    }
    if (!target) continue;
    const isSpecial = (specialMappingTargets as readonly string[]).includes(target);
    if (!isSpecial && !byKey.has(target)) {
      throw new ValidationError(
        `El destino "${target}" de la columna "${header}" no es un campo de la capa.`,
      );
    }
    if (target === MAPPING_TARGETS.roleId && !layer.hasRole) {
      throw new ValidationError(
        `La capa "${layer.name}" no usa Rol SII. Marca la columna "${header}" como "Ignorar".`,
      );
    }
    const prev = seen.get(target);
    if (prev) {
      const label = targetLabel(layer, target);
      throw new ValidationError(
        `Las columnas "${prev}" y "${header}" apuntan al mismo destino (${label}). Cada destino se usa una sola vez.`,
      );
    }
    seen.set(target, header);
  }

  const mapping = resolveMapping(layer, input.columnMapping);

  if ((mapping.latHeader === null) !== (mapping.lonHeader === null)) {
    throw new ValidationError('Latitud y longitud van juntas: mapea las dos columnas o ninguna.');
  }

  if (layer.hasRole) {
    const addressMapped =
      !!layer.addressFieldKey && mapping.fields.some((f) => f.field.key === layer.addressFieldKey);
    if (!mapping.roleHeader && !addressMapped) {
      const addressField = layer.addressFieldKey ? byKey.get(layer.addressFieldKey) : undefined;
      throw new ValidationError(
        addressField
          ? `Mapea la columna del Rol SII o la del campo de dirección (${addressField.label}).`
          : 'Mapea la columna del Rol SII.',
      );
    }
  }

  const missingRequired = layer.fields.filter(
    (f) => f.required && !mapping.fields.some((m) => m.field.key === f.key),
  );
  if (missingRequired.length) {
    const labels = missingRequired.map((f) => `"${f.label}"`).join(', ');
    throw new ValidationError(
      missingRequired.length === 1
        ? `El campo requerido ${labels} no está mapeado.`
        : `Los campos requeridos ${labels} no están mapeados.`,
    );
  }

  if (mapping.fields.length === 0 && !mapping.roleHeader) {
    throw new ValidationError('Mapea al menos una columna del archivo a un campo de la capa.');
  }

  if (input.fullReplace) {
    if (!layerDetectsDuplicates(layer)) {
      throw new ValidationError(
        'El reemplazo completo requiere que la capa tenga campos únicos para reconocer qué registros ya existen.',
      );
    }
    if (input.rowFrom || input.rowTo) {
      throw new ValidationError(
        'El reemplazo completo no admite un rango de filas: el archivo debe ser la capa completa.',
      );
    }
    const uniqueMapped = layer.uniqueKeys.every((k) => mapping.fields.some((m) => m.field.key === k));
    if (!uniqueMapped) {
      const labels = layer.uniqueKeys.map((k) => `"${byKey.get(k)?.label ?? k}"`).join(', ');
      throw new ValidationError(
        `Para el reemplazo completo deben estar mapeados los campos únicos (${labels}).`,
      );
    }
  }

  return mapping;
}

function targetLabel(layer: Pick<LayerRow, 'fields'>, target: string): string {
  if (target === MAPPING_TARGETS.roleId) return 'Rol SII';
  if (target === MAPPING_TARGETS.lat) return 'Latitud';
  if (target === MAPPING_TARGETS.lon) return 'Longitud';
  if (target === MAPPING_TARGETS.comments) return 'Comentarios';
  return layer.fields.find((f) => f.key === target)?.label ?? target;
}

// ---------- contexto ----------

type RoleInfo = {
  id: string;
  exists: boolean;
  lat: number | null;
  lon: number | null;
  supersededAt: string | null;
  resultRoleIds: string[];
  /** Registros del rol en esta capa (solo se usa si la capa no detecta duplicados). */
  recordCount: number;
};

export type AnalysisContext = {
  layer: LayerRow;
  mapping: ResolvedMapping;
  geocodeEnabled: boolean;
  getRole(roleId: string): Promise<RoleInfo>;
  geocodeLocal(address: string): Promise<GeocodeResult | null>;
  findExistingDuplicates(
    identity: Identity,
    roleId: string | null,
    attributes: Record<string, unknown>,
  ): Promise<number[]>;
  /** Primera fila anterior del archivo con la misma identidad, o null. */
  findFileDuplicate(
    identity: Identity,
    rowNumber: number,
    roleId: string | null,
    attributes: Record<string, unknown>,
  ): Promise<number | null>;
};

type RoleRowLite = { id: string; lat: number | null; lon: number | null; supersededAt: string | null };

async function loadResultRoles(db: DbOrTx, roleIds: string[]): Promise<Map<string, string[]>> {
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

async function loadRoleCounts(db: DbOrTx, layerId: number, roleIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (roleIds.length === 0) return map;
  const rows = await db
    .select({ roleId: records.roleId, n: sql<number>`count(*)::int` })
    .from(records)
    .where(and(eq(records.layerId, layerId), inArray(records.roleId, roleIds)))
    .groupBy(records.roleId);
  for (const r of rows) if (r.roleId) map.set(r.roleId, Number(r.n));
  return map;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadRoleInfos(db: DbOrTx, layer: LayerRow, roleIds: string[]): Promise<Map<string, RoleInfo>> {
  const map = new Map<string, RoleInfo>();
  const unique = [...new Set(roleIds)];
  if (unique.length === 0) return map;
  const found: RoleRowLite[] = [];
  for (const part of chunk(unique, 5000)) {
    const rows = await db
      .select({ id: roles.id, lat: roles.lat, lon: roles.lon, supersededAt: roles.supersededAt })
      .from(roles)
      .where(inArray(roles.id, part));
    found.push(...rows);
  }
  const superseded = found.filter((r) => r.supersededAt !== null).map((r) => r.id);
  const results = await loadResultRoles(db, superseded);
  const counts = layerDetectsDuplicates(layer)
    ? new Map<string, number>()
    : await loadRoleCounts(
        db,
        layer.id,
        found.map((r) => r.id),
      );
  for (const r of found) {
    map.set(r.id, {
      id: r.id,
      exists: true,
      lat: r.lat,
      lon: r.lon,
      supersededAt: r.supersededAt,
      resultRoleIds: results.get(r.id) ?? [],
      recordCount: counts.get(r.id) ?? 0,
    });
  }
  for (const id of unique) {
    if (!map.has(id))
      map.set(id, {
        id,
        exists: false,
        lat: null,
        lon: null,
        supersededAt: null,
        resultRoleIds: [],
        recordCount: 0,
      });
  }
  return map;
}

export type BulkContextOptions = {
  geocoder?: Geocoder;
};

/** Contexto para analizar un archivo completo: prefetch de roles, índice de identidades y caché de direcciones. */
export async function createBulkContext(
  db: DbOrTx,
  layer: LayerRow,
  mapping: ResolvedMapping,
  rows: TableRow[],
  geocodeEnabled: boolean,
  opts: BulkContextOptions = {},
): Promise<AnalysisContext> {
  const geocoder = opts.geocoder ?? getGeocoder(db);

  const roleIds: string[] = [];
  if (mapping.roleHeader) {
    for (const r of rows) {
      const n = tryNormalizeRoleId(r.values[mapping.roleHeader]);
      if (n.ok && n.value) roleIds.push(n.value);
    }
  }
  const roleCache = await loadRoleInfos(db, layer, roleIds);

  // Solo se geocodifican las direcciones de las filas que lo van a necesitar (§8.3): sin coordenadas propias
  // y sin un rol con coordenadas. Así un archivo con 40k roles ubicados no consulta el padrón 40k veces.
  const addressField = layer.addressFieldKey
    ? mapping.fields.find((f) => f.field.key === layer.addressFieldKey)
    : undefined;
  const addresses: string[] = [];
  if (geocodeEnabled && addressField) {
    for (const r of rows) {
      const a = r.values[addressField.header]?.trim();
      if (!a) continue;
      if (mapping.latHeader && mapping.lonHeader) {
        const pair = parseCoordinatePair(r.values[mapping.latHeader], r.values[mapping.lonHeader]);
        if (pair.ok && pair.lat !== null) continue;
      }
      if (mapping.roleHeader) {
        const n = tryNormalizeRoleId(r.values[mapping.roleHeader]);
        const role = n.ok && n.value ? roleCache.get(n.value) : undefined;
        if (role && role.lat !== null && role.lon !== null) continue;
      }
      addresses.push(a);
    }
  }
  const local = addresses.length
    ? await batchGeocodeLocal(db, addresses)
    : new Map<string, GeocodeResult | null>();
  const geocodeCache = new Map<string, Promise<GeocodeResult | null>>();

  const identityIndex = await loadIdentityIndex(db, layer);
  const fileIdentities = new Map<string, number>();

  return {
    layer,
    mapping,
    geocodeEnabled,
    async getRole(roleId) {
      const hit = roleCache.get(roleId);
      if (hit) return hit;
      const loaded = await loadRoleInfos(db, layer, [roleId]);
      const info = loaded.get(roleId)!;
      roleCache.set(roleId, info);
      return info;
    },
    geocodeLocal(address) {
      const n = normalizeAddress(address);
      if (!n.addressNorm) return Promise.resolve(null);
      if (local.has(n.addressNorm)) return Promise.resolve(local.get(n.addressNorm) ?? null);
      const cached = geocodeCache.get(n.addressNorm);
      if (cached) return cached;
      const p = geocoder.geocodeLocal(address).catch(() => null);
      geocodeCache.set(n.addressNorm, p);
      return p;
    },
    findExistingDuplicates(identity) {
      return Promise.resolve(identityIndex.get(identity.key) ?? []);
    },
    findFileDuplicate(identity, rowNumber) {
      const first = fileIdentities.get(identity.key);
      if (first !== undefined && first !== rowNumber) return Promise.resolve(first);
      if (first === undefined) fileIdentities.set(identity.key, rowNumber);
      return Promise.resolve(null);
    },
  };
}

/** Contexto para re-analizar una fila sola (corrección en la revisión): consultas puntuales. */
export function createIncrementalContext(
  db: DbOrTx,
  importId: string,
  layer: LayerRow,
  mapping: ResolvedMapping,
  geocodeEnabled: boolean,
  opts: BulkContextOptions = {},
): AnalysisContext {
  const geocoder = opts.geocoder ?? getGeocoder(db);
  const roleCache = new Map<string, RoleInfo>();
  return {
    layer,
    mapping,
    geocodeEnabled,
    async getRole(roleId) {
      const hit = roleCache.get(roleId);
      if (hit) return hit;
      const loaded = await loadRoleInfos(db, layer, [roleId]);
      const info = loaded.get(roleId)!;
      roleCache.set(roleId, info);
      return info;
    },
    geocodeLocal: (address) => geocoder.geocodeLocal(address).catch(() => null),
    findExistingDuplicates: (identity, roleId, attributes) =>
      findDuplicateIds(db, layer, identity, undefined, roleId, attributes),
    async findFileDuplicate(identity, rowNumber, roleId, attributes) {
      const conds = [
        eq(importRows.importId, importId),
        ne(importRows.rowNumber, rowNumber),
        ne(importRows.status, 'excluded'),
        isNotNull(importRows.parsed),
      ];
      if (layer.hasRole) conds.push(sql`${importRows.parsed}->>'roleId' = ${roleId ?? ''}`);
      for (const k of layer.uniqueKeys) {
        const norm = normalizeIdentityValue(attributes[k]);
        conds.push(sql`${normalizeIdentitySql(sql`${importRows.parsed}->'attributes'->>${k}`)} = ${norm}`);
      }
      const candidates = await db
        .select({ rowNumber: importRows.rowNumber, parsed: importRows.parsed })
        .from(importRows)
        .where(and(...conds))
        .limit(2000);
      const matches = candidates
        .filter(
          (c) => c.parsed && buildIdentity(layer, c.parsed.roleId, c.parsed.attributes)?.key === identity.key,
        )
        .map((c) => c.rowNumber)
        .filter((n) => n < rowNumber)
        .sort((a, b) => a - b);
      return matches[0] ?? null;
    },
  };
}

// ---------- análisis de una fila ----------

export type RowOverrides = {
  /** Rol fijado a mano (cuando el archivo no trae columna de rol o se acepta una sugerencia). */
  roleId?: string | null;
  /** Coordenadas fijadas a mano (quedan como 'own'). */
  coords?: { lat: number; lon: number } | null;
};

export type RowAnalysis = {
  parsed: ParsedRow;
  status: ImportRowStatus;
  messages: ImportMessage[];
  duplicateOf: number[];
  fileDuplicateOf: number | null;
  identity: Identity | null;
  /** Dirección sin ubicación local: se encola en `import.geocode-external`. */
  needsExternalGeocode: boolean;
  address: string | null;
};

const msg = (
  level: ImportMessage['level'],
  code: ImportMessage['code'],
  message: string,
  data?: Record<string, unknown>,
): ImportMessage => (data ? { level, code, message, data } : { level, code, message });

export function statusFromMessages(messages: ImportMessage[], isDuplicate: boolean): ImportRowStatus {
  if (messages.some((m) => m.level === 'error')) return 'error';
  if (isDuplicate) return 'duplicate';
  if (messages.some((m) => m.level === 'warning')) return 'warning';
  return 'valid';
}

function toCandidates(result: GeocodeResult): GeocodeCandidate[] {
  if (result.candidates?.length) return result.candidates;
  return [
    {
      lat: result.lat,
      lon: result.lon,
      label: result.label,
      roleId: result.roleId ?? null,
      confidence: result.confidence,
    },
  ];
}

export function locationApproxMessage(result: GeocodeResult): ImportMessage {
  return msg(
    'warning',
    'location_approx',
    `Ubicación aproximada (${geocodeConfidenceLabels[result.confidence].toLowerCase()}): ${result.label}. Acéptala o elige otra.`,
    {
      candidates: toCandidates(result),
      label: result.label,
      confidence: result.confidence,
      provider: result.provider,
    },
  );
}

export const LOCATION_MISSING_MESSAGE: ImportMessage = msg(
  'warning',
  'location_missing',
  'Sin ubicación: el registro aparecerá en la tabla, pero no en el mapa.',
);

const LOCATION_PENDING_MESSAGE: ImportMessage = msg(
  'warning',
  'location_pending',
  'Buscando la dirección en OpenStreetMap…',
);

function roleMessages(role: RoleInfo, layer: LayerRow): ImportMessage[] {
  const out: ImportMessage[] = [];
  if (!role.exists) {
    out.push(
      msg('warning', 'role_new', `El rol ${role.id} no está en el padrón. Se creará al importar.`, {
        roleId: role.id,
      }),
    );
  }
  if (role.supersededAt) {
    const results = role.resultRoleIds;
    out.push(
      msg(
        'warning',
        'role_superseded',
        results.length
          ? `El rol ${role.id} ya no está vigente: fue reemplazado por ${results.join(', ')}.`
          : `El rol ${role.id} ya no está vigente.`,
        { roleId: role.id, resultRoleIds: results, supersededAt: role.supersededAt },
      ),
    );
  }
  if (role.exists && !layerDetectsDuplicates(layer) && role.recordCount > 0) {
    out.push(
      msg(
        'info',
        'role_has_records',
        `El rol ${role.id} ya tiene ${role.recordCount} registro${role.recordCount === 1 ? '' : 's'} en esta capa.`,
        { roleId: role.id, count: role.recordCount },
      ),
    );
  }
  return out;
}

/** Claves reservadas dentro de `raw` para valores fijados a mano cuando el archivo no trae esa columna. */
export const RAW_OVERRIDE_KEYS = { roleId: '__roleId', lat: '__lat', lon: '__lon' } as const;
export function isRawOverrideKey(key: string): boolean {
  return key.startsWith('__');
}

/** Valores fijados a mano guardados en `raw` (persisten entre re-análisis). */
function overridesFromRaw(raw: Record<string, string>): RowOverrides {
  const out: RowOverrides = {};
  if (raw[RAW_OVERRIDE_KEYS.roleId] !== undefined) out.roleId = raw[RAW_OVERRIDE_KEYS.roleId] || null;
  const lat = raw[RAW_OVERRIDE_KEYS.lat];
  const lon = raw[RAW_OVERRIDE_KEYS.lon];
  if (lat !== undefined && lon !== undefined) {
    const pair = parseCoordinatePair(lat, lon);
    out.coords = pair.ok && pair.lat !== null ? { lat: pair.lat, lon: pair.lon } : null;
  }
  return out;
}

export async function analyzeRow(
  ctx: AnalysisContext,
  rowNumber: number,
  raw: Record<string, string>,
  explicitOverrides: RowOverrides = {},
): Promise<RowAnalysis> {
  const { layer, mapping } = ctx;
  const messages: ImportMessage[] = [];
  const overrides: RowOverrides = { ...overridesFromRaw(raw), ...explicitOverrides };

  // 1. rol (§8.1)
  let roleId: string | null = null;
  if (overrides.roleId !== undefined) {
    const n = tryNormalizeRoleId(overrides.roleId);
    if (!n.ok) messages.push(msg('error', 'role_invalid', `Rol "${overrides.roleId}": ${n.error}`));
    else roleId = n.value;
  } else if (mapping.roleHeader) {
    const value = raw[mapping.roleHeader] ?? '';
    const n = tryNormalizeRoleId(value);
    if (!n.ok) {
      messages.push(
        msg(
          'error',
          'role_invalid',
          `Rol "${value.trim()}": debe ser dos grupos de números separados por guion, por ejemplo 04631-00030.`,
        ),
      );
    } else roleId = n.value;
  }

  // 2. coordenadas (§8.2)
  let own: { lat: number; lon: number } | null = null;
  if (overrides.coords !== undefined) {
    own = overrides.coords;
  } else if (mapping.latHeader && mapping.lonHeader) {
    const pair = parseCoordinatePair(raw[mapping.latHeader], raw[mapping.lonHeader]);
    if (!pair.ok) messages.push(msg('error', 'coords_out_of_range', `${pair.error}.`));
    else if (pair.lat !== null) {
      own = { lat: pair.lat, lon: pair.lon };
      if (pair.warning) {
        messages.push(
          msg(
            'warning',
            'coords_outside_comuna',
            'Las coordenadas quedan fuera de la comuna de El Bosque. Se importarán igual; revisa que no estén invertidas.',
          ),
        );
      }
    }
  }

  // 3. atributos por tipo (§5.4)
  const rawAttrs: Record<string, unknown> = {};
  for (const { header, field } of mapping.fields) rawAttrs[field.key] = raw[header] ?? '';
  const cast = castAttributes(rawAttrs, layer.fields, { allowAutonumber: true });
  const errorKeys = new Set<string>();
  for (const e of cast.errors) {
    errorKeys.add(e.key);
    const field = layer.fields.find((f) => f.key === e.key);
    messages.push(
      msg(
        'error',
        field?.type === 'autonumber' ? 'autonumber_invalid' : 'type_invalid',
        `${e.label}: ${e.message}.`,
        { key: e.key },
      ),
    );
  }

  // 4. requeridos
  for (const f of layer.fields) {
    if (!f.required || errorKeys.has(f.key)) continue;
    if (isEmptyValue(cast.attributes[f.key])) {
      messages.push(
        msg('error', 'required_missing', `Falta el campo obligatorio "${f.label}".`, { key: f.key }),
      );
    }
  }

  // 5. comentarios
  const comments = mapping.commentsHeader ? (raw[mapping.commentsHeader] ?? '').trim() || null : null;

  // 6. rol: nuevo, no vigente, con registros
  let role: RoleInfo | null = roleId ? await ctx.getRole(roleId) : null;
  if (role) messages.push(...roleMessages(role, layer));

  // 7. ubicación (§8.3) con el geocodificador local (§8.7)
  const addressValue = layer.addressFieldKey ? cast.attributes[layer.addressFieldKey] : null;
  const address = typeof addressValue === 'string' && addressValue.trim() ? addressValue.trim() : null;
  const canGeocode = ctx.geocodeEnabled && !!address;
  const resolved = await resolveCoordinatesForNew({
    own,
    role: role ? { id: role.id, lat: role.lat, lon: role.lon } : null,
    address,
    geocode: canGeocode ? (a) => ctx.geocodeLocal(a) : undefined,
    layerHasRole: layer.hasRole,
  });

  const parsed: ParsedRow = {
    roleId,
    lat: resolved.lat,
    lon: resolved.lon,
    coordsSource: resolved.coordsSource,
    geocode: resolved.geocode,
    attributes: cast.attributes,
    comments,
    suggestedRoleId: null,
    suggestedLocation: null,
  };

  if (resolved.roleAssignedByAddress) {
    parsed.roleId = resolved.roleAssignedByAddress;
    messages.push(
      msg(
        'warning',
        'role_assigned_by_address',
        `Rol ${parsed.roleId} asignado por la dirección (coincide exacto con el padrón).`,
        {
          roleId: parsed.roleId,
        },
      ),
    );
    role = await ctx.getRole(parsed.roleId);
    messages.push(...roleMessages(role, layer));
  } else if (resolved.coordsSource === 'geocoded' && resolved.geocodeResult) {
    const gr = resolved.geocodeResult;
    if (gr.confidence !== 'exact') {
      // Aproximado: queda como sugerencia hasta que el usuario la acepte (§8.7).
      parsed.lat = null;
      parsed.lon = null;
      parsed.coordsSource = null;
      parsed.geocode = null;
      parsed.suggestedLocation = { lat: gr.lat, lon: gr.lon, geocode: resolved.geocode as RecordGeocodeInfo };
      messages.push(locationApproxMessage(gr));
      if (layer.hasRole && !roleId && gr.provider === 'padron' && gr.roleId) {
        parsed.suggestedRoleId = gr.roleId;
        messages.push(
          msg(
            'warning',
            'role_suggested_by_address',
            `La dirección se parece a la del rol ${gr.roleId}. Acéptalo si corresponde.`,
            {
              roleId: gr.roleId,
            },
          ),
        );
      }
    }
  }

  let needsExternalGeocode = false;
  if (parsed.lat === null && !parsed.suggestedLocation) {
    if (canGeocode && !own) {
      needsExternalGeocode = true;
      messages.push(LOCATION_PENDING_MESSAGE);
    } else {
      messages.push(LOCATION_MISSING_MESSAGE);
    }
  }

  // 8. identidad y duplicados (§8.4)
  let duplicateOf: number[] = [];
  let fileDuplicateOf: number | null = null;
  const identity = buildIdentity(layer, parsed.roleId, parsed.attributes);
  if (identity) {
    if (!identity.complete) {
      const missing = Object.entries(identity.parts)
        .filter(([, v]) => v === '')
        .map(([k]) => k);
      messages.push(
        msg(
          'warning',
          'unique_keys_incomplete',
          `Faltan datos para comparar con los registros existentes (${missing.join(', ')}).`,
          {
            missing,
          },
        ),
      );
    } else {
      duplicateOf = await ctx.findExistingDuplicates(identity, parsed.roleId, parsed.attributes);
      fileDuplicateOf = await ctx.findFileDuplicate(identity, rowNumber, parsed.roleId, parsed.attributes);
      if (duplicateOf.length) {
        messages.push(
          msg(
            'warning',
            'duplicate_existing',
            duplicateOf.length === 1
              ? `Ya existe un registro con ${describeIdentity(identity)}.`
              : `Ya existen ${duplicateOf.length} registros con ${describeIdentity(identity)}.`,
            { recordIds: duplicateOf },
          ),
        );
      }
      if (fileDuplicateOf !== null) {
        messages.push(
          msg(
            'warning',
            'duplicate_in_file',
            `Repetido en el archivo: la fila ${fileDuplicateOf} también tiene ${describeIdentity(identity)}.`,
            {
              rowNumber: fileDuplicateOf,
            },
          ),
        );
      }
    }
  }

  const isDuplicate = duplicateOf.length > 0 || fileDuplicateOf !== null;
  return {
    parsed,
    status: statusFromMessages(messages, isDuplicate),
    messages,
    duplicateOf,
    fileDuplicateOf,
    identity,
    needsExternalGeocode,
    address,
  };
}

/** Resolución inicial de duplicados según la estrategia (§8.5 paso 3). */
export function initialResolution(
  a: Pick<RowAnalysis, 'status' | 'duplicateOf' | 'fileDuplicateOf'>,
  strategy: 'ask' | 'skip' | 'update',
): { resolution: 'create' | 'update' | 'skip' | null; updateTargetId: number | null } {
  if (a.status !== 'duplicate') return { resolution: null, updateTargetId: null };
  if (strategy === 'skip') return { resolution: 'skip', updateTargetId: null };
  if (strategy === 'update' && a.duplicateOf.length === 1 && a.fileDuplicateOf === null) {
    return { resolution: 'update', updateTargetId: a.duplicateOf[0]! };
  }
  return { resolution: null, updateTargetId: null };
}

/** Aplica al `parsed` la ubicación sugerida (o un candidato), quitando la advertencia de ubicación aproximada. */
export function applyLocation(
  parsed: ParsedRow,
  messages: ImportMessage[],
  location: { lat: number; lon: number; geocode: RecordGeocodeInfo },
): { parsed: ParsedRow; messages: ImportMessage[] } {
  const next: ParsedRow = {
    ...parsed,
    lat: location.lat,
    lon: location.lon,
    coordsSource: 'geocoded',
    geocode: location.geocode,
    suggestedLocation: null,
  };
  const filtered = messages.filter(
    (m) => m.code !== 'location_approx' && m.code !== 'location_missing' && m.code !== 'location_pending',
  );
  return { parsed: next, messages: filtered };
}
