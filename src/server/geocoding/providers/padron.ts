import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import type { GeocodeCandidate, GeocodeResult } from '@/shared/schemas/geocode';
import type { GeocodeProvider } from './types';

/**
 * Proveedor local sobre el padrón de roles (§8.7):
 *  - exact: misma calle y mismo número → coordenadas y roleId del predio
 *  - interpolated: misma calle sin ese número → interpola entre los dos números más cercanos de la misma paridad
 *  - approx: similitud trigram de address_norm ≥ 0,6 → mejor candidato, con hasta 3 candidatos
 */

type RoleHit = { id: string; lat: number; lon: number; address: string | null; house_number: number | null };

export function createPadronProvider(db: DbOrTx): GeocodeProvider {
  return {
    name: 'padron',
    local: true,
    async geocode(address, n): Promise<GeocodeResult | null> {
      if (!n.addressNorm) return null;

      if (n.streetNorm && n.houseNumber !== null) {
        const exact = await db.execute<RoleHit>(sql`
          SELECT id, lat, lon, address, house_number FROM roles
          WHERE street_norm = ${n.streetNorm} AND house_number = ${n.houseNumber} AND lat IS NOT NULL
          ORDER BY id LIMIT 1
        `);
        const hit = exact[0];
        if (hit) {
          return {
            lat: Number(hit.lat),
            lon: Number(hit.lon),
            provider: 'padron',
            confidence: 'exact',
            roleId: hit.id,
            label: hit.address ?? address,
          };
        }

        // interpolación entre vecinos de la misma calle y paridad
        const parity = n.houseNumber % 2;
        const neighbors = await db.execute<RoleHit>(sql`
          (SELECT id, lat, lon, address, house_number FROM roles
             WHERE street_norm = ${n.streetNorm} AND house_number < ${n.houseNumber} AND house_number % 2 = ${parity} AND lat IS NOT NULL
             ORDER BY house_number DESC LIMIT 1)
          UNION ALL
          (SELECT id, lat, lon, address, house_number FROM roles
             WHERE street_norm = ${n.streetNorm} AND house_number > ${n.houseNumber} AND house_number % 2 = ${parity} AND lat IS NOT NULL
             ORDER BY house_number ASC LIMIT 1)
        `);
        const below = neighbors.find((r) => Number(r.house_number) < n.houseNumber!);
        const above = neighbors.find((r) => Number(r.house_number) > n.houseNumber!);
        if (below && above) {
          const nb = Number(below.house_number);
          const na = Number(above.house_number);
          const t = (n.houseNumber - nb) / (na - nb);
          // solo interpolar si los vecinos están razonablemente cerca (misma cuadra o contigua)
          if (na - nb <= 400) {
            return {
              lat: round6(Number(below.lat) + (Number(above.lat) - Number(below.lat)) * t),
              lon: round6(Number(below.lon) + (Number(above.lon) - Number(below.lon)) * t),
              provider: 'padron',
              confidence: 'interpolated',
              label: `${n.streetNorm} ${n.houseNumber} (estimado entre ${nb} y ${na})`,
              candidates: [toCandidate(below, 'approx'), toCandidate(above, 'approx')],
            };
          }
        }
        const nearest = below ?? above;
        if (nearest && Math.abs(Number(nearest.house_number) - n.houseNumber) <= 20) {
          return {
            lat: Number(nearest.lat),
            lon: Number(nearest.lon),
            provider: 'padron',
            confidence: 'approx',
            label: nearest.address ?? address,
            candidates: [toCandidate(nearest, 'approx')],
          };
        }
      }

      // similitud trigram
      const approx = await db.execute<RoleHit & { sim: number }>(sql`
        SELECT id, lat, lon, address, house_number, similarity(address_norm, ${n.addressNorm}) AS sim
        FROM roles
        WHERE lat IS NOT NULL AND address_norm % ${n.addressNorm}
        ORDER BY sim DESC, id
        LIMIT 3
      `);
      const best = approx[0];
      if (best && Number(best.sim) >= 0.6) {
        return {
          lat: Number(best.lat),
          lon: Number(best.lon),
          provider: 'padron',
          confidence: 'approx',
          roleId: best.id,
          label: best.address ?? address,
          candidates: approx.map((r) => toCandidate(r, 'approx')),
        };
      }
      return null;
    },
  };
}

function toCandidate(r: RoleHit, confidence: GeocodeCandidate['confidence']): GeocodeCandidate {
  return { lat: Number(r.lat), lon: Number(r.lon), label: r.address ?? r.id, roleId: r.id, confidence };
}

function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

