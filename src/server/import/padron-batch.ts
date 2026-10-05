import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import type { GeocodeCandidate, GeocodeResult } from '@/shared/schemas/geocode';
import { normalizeAddress } from '../geocoding/normalize-address';
import { isInsideComuna, round6 } from '../parsing/coordinates';

/**
 * Geocodificación local en lote para el análisis de importaciones (§8.5 paso 2, §8.7 "padron").
 * Replica las reglas del proveedor `padron` (exact → interpolated → approx por vecinos → approx por trigram)
 * pero con una consulta por lote en vez de 2–3 por dirección: 40k direcciones distintas caben en pocos segundos.
 * Si cambian las reglas del proveedor `padron`, este módulo debe cambiar igual (hay un test que compara ambos).
 */

type RoleHit = { id: string; lat: number; lon: number; address: string | null; house_number: number | null };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toCandidate(r: RoleHit, confidence: GeocodeCandidate['confidence']): GeocodeCandidate {
  return { lat: Number(r.lat), lon: Number(r.lon), label: r.address ?? r.id, roleId: r.id, confidence };
}

function insideOnly(result: GeocodeResult | null): GeocodeResult | null {
  if (!result || !isInsideComuna(result.lat, result.lon)) return null;
  return { ...result, candidates: result.candidates?.filter((c) => isInsideComuna(c.lat, c.lon)) };
}

export type LocalGeocodeMap = Map<string, GeocodeResult | null>;

/** Resuelve en lote todas las direcciones contra el padrón. La clave del mapa es `addressNorm`. */
export async function batchGeocodeLocal(db: DbOrTx, addresses: Iterable<string>): Promise<LocalGeocodeMap> {
  type Entry = {
    addressNorm: string;
    streetNorm: string | null;
    houseNumber: number | null;
    original: string;
  };
  const entries = new Map<string, Entry>();
  for (const a of addresses) {
    const n = normalizeAddress(a);
    if (!n.addressNorm || entries.has(n.addressNorm)) continue;
    entries.set(n.addressNorm, {
      addressNorm: n.addressNorm,
      streetNorm: n.streetNorm,
      houseNumber: n.houseNumber,
      original: a,
    });
  }
  const out: LocalGeocodeMap = new Map();
  if (entries.size === 0) return out;

  // 1. exactos: misma calle y número
  const withNumber = [...entries.values()].filter((e) => e.streetNorm && e.houseNumber !== null);
  const pairKey = (s: string, n: number) => `${s}|${n}`;
  const exact = new Map<string, RoleHit>();
  const pairs = new Map<string, { street: string; number: number }>();
  for (const e of withNumber)
    pairs.set(pairKey(e.streetNorm!, e.houseNumber!), { street: e.streetNorm!, number: e.houseNumber! });
  for (const part of chunk([...pairs.values()], 2000)) {
    const values = sql.join(
      part.map((p) => sql`(${p.street}, ${p.number}::int)`),
      sql`, `,
    );
    const rows = await db.execute<RoleHit & { street_norm: string }>(sql`
      SELECT DISTINCT ON (r.street_norm, r.house_number) r.id, r.lat, r.lon, r.address, r.street_norm, r.house_number
      FROM roles r
      JOIN (VALUES ${values}) AS v(street, number) ON v.street = r.street_norm AND v.number = r.house_number
      WHERE r.lat IS NOT NULL
      ORDER BY r.street_norm, r.house_number, r.id
    `);
    for (const r of rows) exact.set(pairKey(r.street_norm, Number(r.house_number)), r);
  }

  const pending: Entry[] = [];
  for (const e of entries.values()) {
    const hit =
      e.streetNorm && e.houseNumber !== null ? exact.get(pairKey(e.streetNorm, e.houseNumber)) : undefined;
    if (hit) {
      out.set(
        e.addressNorm,
        insideOnly({
          lat: Number(hit.lat),
          lon: Number(hit.lon),
          provider: 'padron',
          confidence: 'exact',
          roleId: hit.id,
          label: hit.address ?? e.original,
        }),
      );
      if (out.get(e.addressNorm)) continue;
    }
    pending.push(e);
  }

  // 2. vecinos de la misma calle y paridad (interpolación o el más cercano a ≤ 20 números)
  const streets = [
    ...new Set(pending.filter((e) => e.streetNorm && e.houseNumber !== null).map((e) => e.streetNorm!)),
  ];
  const byStreet = new Map<string, RoleHit[]>();
  for (const part of chunk(streets, 1000)) {
    const rows = await db.execute<RoleHit & { street_norm: string }>(sql`
      SELECT id, lat, lon, address, street_norm, house_number FROM roles
      WHERE street_norm IN ${part} AND lat IS NOT NULL AND house_number IS NOT NULL
      ORDER BY street_norm, house_number, id
    `);
    for (const r of rows) {
      const list = byStreet.get(r.street_norm) ?? [];
      list.push(r);
      byStreet.set(r.street_norm, list);
    }
  }
  const remaining: Entry[] = [];
  for (const e of pending) {
    const list = e.streetNorm && e.houseNumber !== null ? byStreet.get(e.streetNorm) : undefined;
    if (!list || !list.length) {
      remaining.push(e);
      continue;
    }
    const num = e.houseNumber!;
    const parity = num % 2;
    let below: RoleHit | undefined;
    let above: RoleHit | undefined;
    for (const r of list) {
      const hn = Number(r.house_number);
      if (hn % 2 !== parity) continue;
      if (hn < num)
        below = r; // la lista va ascendente: el último menor es el más cercano
      else if (hn > num) {
        above = r;
        break;
      }
    }
    let result: GeocodeResult | null = null;
    if (below && above) {
      const nb = Number(below.house_number);
      const na = Number(above.house_number);
      if (na - nb <= 400) {
        const t = (num - nb) / (na - nb);
        result = {
          lat: round6(Number(below.lat) + (Number(above.lat) - Number(below.lat)) * t),
          lon: round6(Number(below.lon) + (Number(above.lon) - Number(below.lon)) * t),
          provider: 'padron',
          confidence: 'interpolated',
          label: `${e.streetNorm} ${num} (estimado entre ${nb} y ${na})`,
          candidates: [toCandidate(below, 'approx'), toCandidate(above, 'approx')],
        };
      }
    }
    if (!result) {
      const nearest = below ?? above;
      if (nearest && Math.abs(Number(nearest.house_number) - num) <= 20) {
        result = {
          lat: Number(nearest.lat),
          lon: Number(nearest.lon),
          provider: 'padron',
          confidence: 'approx',
          label: nearest.address ?? e.original,
          candidates: [toCandidate(nearest, 'approx')],
        };
      }
    }
    const inside = insideOnly(result);
    if (inside) out.set(e.addressNorm, inside);
    else remaining.push(e);
  }

  // 3. similitud trigram sobre la dirección completa (≥ 0,6), hasta 3 candidatos
  for (const part of chunk(remaining, 200)) {
    const values = sql.join(
      part.map((e) => sql`(${e.addressNorm})`),
      sql`, `,
    );
    const rows = await db.execute<RoleHit & { q: string; sim: number }>(sql`
      SELECT v.q, r.id, r.lat, r.lon, r.address, r.house_number, r.sim
      FROM (VALUES ${values}) AS v(q)
      JOIN LATERAL (
        SELECT id, lat, lon, address, house_number, similarity(address_norm, v.q) AS sim
        FROM roles
        WHERE lat IS NOT NULL AND address_norm % v.q
        ORDER BY sim DESC, id
        LIMIT 3
      ) r ON true
      ORDER BY v.q, r.sim DESC, r.id
    `);
    const grouped = new Map<string, (RoleHit & { sim: number })[]>();
    for (const r of rows) {
      const list = grouped.get(r.q) ?? [];
      list.push(r);
      grouped.set(r.q, list);
    }
    for (const e of part) {
      const list = grouped.get(e.addressNorm) ?? [];
      const best = list[0];
      if (best && Number(best.sim) >= 0.6) {
        out.set(
          e.addressNorm,
          insideOnly({
            lat: Number(best.lat),
            lon: Number(best.lon),
            provider: 'padron',
            confidence: 'approx',
            roleId: best.id,
            label: best.address ?? e.original,
            candidates: list.map((r) => toCandidate(r, 'approx')),
          }),
        );
      } else {
        out.set(e.addressNorm, null);
      }
    }
  }

  return out;
}
