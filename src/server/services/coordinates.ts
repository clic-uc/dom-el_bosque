import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { records, roles } from '@/db/schema';
import type { CoordsSource } from '@/shared/constants';
import type { GeocodeResult, RecordGeocodeInfo } from '@/shared/schemas/geocode';

/**
 * Todas las reglas de coordenadas de roles y registros en un solo lugar (§8.3).
 */

export type RoleCoords = { id: string; lat: number | null; lon: number | null } | null;

export type ResolvedCoordinates = {
  lat: number | null;
  lon: number | null;
  coordsSource: CoordsSource | null;
  geocode: RecordGeocodeInfo | null;
  /** El rol no tenía coordenadas y debe adoptar las propias del registro (nunca las geocodificadas). */
  roleShouldAdopt: boolean;
  /** Rol asignado por dirección exacta (§8.3 paso 2). */
  roleAssignedByAddress?: string;
  /** Resultado completo de geocodificación, por si la UI quiere mostrar candidatos. */
  geocodeResult?: GeocodeResult | null;
};

export type ResolveInput = {
  own: { lat: number; lon: number } | null;
  role: RoleCoords;
  address?: string | null;
  /** Geocodificador a usar (local en importación, cadena completa en creación puntual). */
  geocode?: (address: string) => Promise<GeocodeResult | null>;
  /** Capa con rol: permite asignar rol por dirección exacta del padrón. */
  layerHasRole?: boolean;
};

/**
 * Orden para ubicar un registro al crearlo o importarlo:
 * 1. propias → 'own'; 2. rol con coordenadas → 'role'; 3. dirección → 'geocoded'; 4. nada.
 */
export async function resolveCoordinatesForNew(input: ResolveInput): Promise<ResolvedCoordinates> {
  const roleHasCoords = !!input.role && input.role.lat !== null && input.role.lon !== null;

  if (input.own) {
    return {
      lat: input.own.lat,
      lon: input.own.lon,
      coordsSource: 'own',
      geocode: null,
      roleShouldAdopt: !!input.role && !roleHasCoords,
    };
  }

  if (input.role && roleHasCoords) {
    return {
      lat: input.role.lat,
      lon: input.role.lon,
      coordsSource: 'role',
      geocode: null,
      roleShouldAdopt: false,
    };
  }

  if (input.address && input.geocode) {
    const result = await input.geocode(input.address);
    if (result) {
      // Dirección exacta del padrón en una capa con rol y sin rol en la fila → se asigna ese rol (§8.3)
      if (result.provider === 'padron' && result.confidence === 'exact' && result.roleId && !input.role && input.layerHasRole) {
        return {
          lat: result.lat,
          lon: result.lon,
          coordsSource: 'role',
          geocode: null,
          roleShouldAdopt: false,
          roleAssignedByAddress: result.roleId,
          geocodeResult: result,
        };
      }
      return {
        lat: result.lat,
        lon: result.lon,
        coordsSource: 'geocoded',
        geocode: { provider: result.provider, confidence: result.confidence, query: input.address },
        roleShouldAdopt: false,
        geocodeResult: result,
      };
    }
    return { lat: null, lon: null, coordsSource: null, geocode: null, roleShouldAdopt: false, geocodeResult: null };
  }

  return { lat: null, lon: null, coordsSource: null, geocode: null, roleShouldAdopt: false };
}

/**
 * Cambio de rol de un registro existente: si sus coordenadas eran 'role' o 'geocoded' y el nuevo rol
 * tiene coordenadas, toma las del nuevo rol; si eran 'own', no cambian. Quitar el rol a un 'role' → 'own'.
 */
export function applyRoleChange(
  current: { lat: number | null; lon: number | null; coordsSource: CoordsSource | null; geocode: RecordGeocodeInfo | null },
  newRole: RoleCoords,
): { lat: number | null; lon: number | null; coordsSource: CoordsSource | null; geocode: RecordGeocodeInfo | null; tookRoleCoords: boolean } {
  const newRoleHasCoords = !!newRole && newRole.lat !== null && newRole.lon !== null;

  if (current.coordsSource === 'own') return { ...current, tookRoleCoords: false };

  if (newRole === null) {
    if (current.coordsSource === 'role') {
      return { lat: current.lat, lon: current.lon, coordsSource: 'own', geocode: null, tookRoleCoords: false };
    }
    return { ...current, tookRoleCoords: false };
  }

  if (newRoleHasCoords) {
    return { lat: newRole.lat, lon: newRole.lon, coordsSource: 'role', geocode: null, tookRoleCoords: true };
  }

  // nuevo rol sin coordenadas
  if (current.coordsSource === 'role') {
    // conservamos la ubicación como propia para no perderla
    return { lat: current.lat, lon: current.lon, coordsSource: 'own', geocode: null, tookRoleCoords: false };
  }
  return { ...current, tookRoleCoords: false };
}

/** Cambian las coordenadas de un rol → se propagan a sus registros 'role', 'geocoded' o sin coordenadas. */
export async function propagateRoleCoordinates(tx: DbOrTx, roleId: string, lat: number, lon: number): Promise<number> {
  const updated = await tx
    .update(records)
    .set({ lat, lon, coordsSource: 'role', geocode: null })
    .where(
      and(
        eq(records.roleId, roleId),
        or(inArray(records.coordsSource, ['role', 'geocoded']), isNull(records.coordsSource)),
      ),
    )
    .returning({ id: records.id });
  return updated.length;
}

/** El rol adopta coordenadas propias de un registro si no tenía (nunca las geocodificadas). */
export async function roleAdoptCoordinates(tx: DbOrTx, roleId: string, lat: number, lon: number): Promise<boolean> {
  const updated = await tx
    .update(roles)
    .set({ lat, lon })
    .where(and(eq(roles.id, roleId), isNull(roles.lat)))
    .returning({ id: roles.id });
  if (updated.length > 0) {
    // otros registros del mismo rol sin ubicación o geocodificados también se ubican
    await tx
      .update(records)
      .set({ lat, lon, coordsSource: 'role', geocode: null })
      .where(and(eq(records.roleId, roleId), or(isNull(records.coordsSource), eq(records.coordsSource, 'geocoded'))));
    return true;
  }
  return false;
}

/** Antes de borrar un rol o quitar `role_id`: los registros 'role' pasan a 'own' (conservan coordenadas). */
export async function detachRoleFromRecords(tx: DbOrTx, roleId: string): Promise<void> {
  await tx
    .update(records)
    .set({ coordsSource: 'own' })
    .where(and(eq(records.roleId, roleId), eq(records.coordsSource, 'role')));
}

/** Tras importar el padrón: reubica los registros de esos roles salvo los 'own' (§7.4). */
export async function propagatePadronCoordinates(tx: DbOrTx, roleIds: string[]): Promise<number> {
  if (roleIds.length === 0) return 0;
  const result = await tx.execute<{ id: number }>(sql`
    UPDATE records r
    SET lat = ro.lat, lon = ro.lon, coords_source = 'role', geocode = NULL, updated_at = now()
    FROM roles ro
    WHERE r.role_id = ro.id
      AND ro.id IN ${roleIds}
      AND ro.lat IS NOT NULL AND ro.lon IS NOT NULL
      AND (r.coords_source IN ('role', 'geocoded') OR r.coords_source IS NULL)
      AND (r.lat IS DISTINCT FROM ro.lat OR r.lon IS DISTINCT FROM ro.lon OR r.coords_source IS DISTINCT FROM 'role')
    RETURNING r.id
  `);
  return result.length;
}
