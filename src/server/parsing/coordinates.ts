import { COMUNA_BOUNDS, COMUNA_BOUNDS_MARGIN } from '@/shared/constants';

/**
 * Parseo de coordenadas (§8.2). Pura, con tests.
 *
 * 1. trim; vacío o `0` → null (los Excel municipales usan 0 como "sin coordenada").
 * 2. Exactamente un separador (`,` o `.`) → Number(v.replace(',', '.')).
 * 3. Más de un separador o fuera de rango → heurística legacy: quitar separadores y signo,
 *    insertar `.` tras los 2 primeros dígitos, reaplicar signo ("-33.546.553" → -33.546553).
 * 4. Redondear a 6 decimales.
 * 5. Fuera de rango → error. En rango pero fuera de la comuna (+0.05°) → advertencia.
 */

export type CoordinateAxis = 'lat' | 'lon';

export type ParsedCoordinate =
  | { ok: true; value: number | null; warning?: 'outside_comuna' }
  | { ok: false; error: string };

const RANGE: Record<CoordinateAxis, [number, number]> = {
  lat: [-90, 90],
  lon: [-180, 180],
};

function inRange(axis: CoordinateAxis, v: number): boolean {
  const [min, max] = RANGE[axis];
  return Number.isFinite(v) && v >= min && v <= max;
}

export function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

function legacyHeuristic(raw: string): number {
  const negative = raw.trim().startsWith('-');
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 3) return Number.NaN;
  const n = Number(`${digits.slice(0, 2)}.${digits.slice(2)}`);
  return negative ? -n : n;
}

export function parseCoordinate(input: unknown, axis: CoordinateAxis): ParsedCoordinate {
  if (input === null || input === undefined) return { ok: true, value: null };

  let value: number;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: 'Coordenada inválida' };
    if (input === 0) return { ok: true, value: null };
    value = input;
    if (!inRange(axis, value)) {
      // número con "puntos de miles" leído por Excel como entero: -33546553
      value = legacyHeuristic(String(input));
    }
  } else {
    const s = String(input).trim();
    if (s === '' || /^-?0+([.,]0+)?$/.test(s)) return { ok: true, value: null };
    const separators = (s.match(/[.,]/g) ?? []).length;
    const simple = Number(s.replace(',', '.'));
    if (separators <= 1 && Number.isFinite(simple) && inRange(axis, simple)) {
      value = simple;
    } else {
      value = legacyHeuristic(s);
    }
  }

  if (!inRange(axis, value)) {
    const label = axis === 'lat' ? 'Latitud' : 'Longitud';
    const [min, max] = RANGE[axis];
    return { ok: false, error: `${label} fuera de rango (debe estar entre ${min} y ${max})` };
  }

  value = round6(value);
  return { ok: true, value };
}

export function isInsideComuna(lat: number, lon: number, margin = COMUNA_BOUNDS_MARGIN): boolean {
  return (
    lat >= COMUNA_BOUNDS.minLat - margin &&
    lat <= COMUNA_BOUNDS.maxLat + margin &&
    lon >= COMUNA_BOUNDS.minLon - margin &&
    lon <= COMUNA_BOUNDS.maxLon + margin
  );
}

export type ParsedCoordinatePair =
  | { ok: true; lat: number; lon: number; warning?: 'outside_comuna' }
  | { ok: true; lat: null; lon: null }
  | { ok: false; error: string };

/** Parsea el par; ambos o ninguno. */
export function parseCoordinatePair(latInput: unknown, lonInput: unknown): ParsedCoordinatePair {
  const lat = parseCoordinate(latInput, 'lat');
  if (!lat.ok) return lat;
  const lon = parseCoordinate(lonInput, 'lon');
  if (!lon.ok) return lon;
  if (lat.value === null && lon.value === null) return { ok: true, lat: null, lon: null };
  if (lat.value === null || lon.value === null) {
    return { ok: false, error: 'Latitud y longitud deben venir juntas' };
  }
  const warning = isInsideComuna(lat.value, lon.value) ? undefined : ('outside_comuna' as const);
  return warning ? { ok: true, lat: lat.value, lon: lon.value, warning } : { ok: true, lat: lat.value, lon: lon.value };
}
