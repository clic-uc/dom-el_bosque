/**
 * Carga `data/geo/*.geojson` a la tabla `polygons` (§10.5), idempotente por (kind, code):
 * actualiza la geometría y conserva nombre editado y adjuntos.
 *
 *   pnpm geo:import
 */
import './_env';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { FeatureCollection } from 'geojson';
import { db, sqlClient } from '@/db/client';
import type { PolygonKind } from '@/shared/constants';

const FILES: { file: string; kind: PolygonKind }[] = [
  { file: 'comuna.geojson', kind: 'comuna' },
  { file: 'sectores.geojson', kind: 'sector' },
  { file: 'villas-poblaciones.geojson', kind: 'villa' },
];

export async function importGeo(dir = path.resolve(process.cwd(), 'data/geo')) {
  const summary: Record<string, { inserted: number; updated: number; unchanged: number }> = {};

  for (const { file, kind } of FILES) {
    const fc = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as FeatureCollection;
    const s = { inserted: 0, updated: 0, unchanged: 0 };

    for (const [i, f] of fc.features.entries()) {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const code = String(f.id ?? props.id ?? i);
      const name = typeof props.name === 'string' ? props.name : null;
      const geomJson = JSON.stringify(f.geometry);

      const result = await db.execute<{ action: string }>(sql`
        WITH incoming AS (
          SELECT ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)))::geometry(MultiPolygon,4326) AS geom
        ),
        upsert AS (
          INSERT INTO polygons (kind, code, name, properties, geom)
          SELECT ${kind}::polygon_kind, ${code}, ${name}, ${JSON.stringify(props)}::jsonb, geom FROM incoming
          ON CONFLICT (kind, code) DO UPDATE
            SET geom = EXCLUDED.geom,
                properties = polygons.properties || EXCLUDED.properties,
                name = COALESCE(polygons.name, EXCLUDED.name),
                updated_at = CASE WHEN ST_Equals(polygons.geom, EXCLUDED.geom) THEN polygons.updated_at ELSE now() END
          RETURNING (xmax = 0) AS inserted,
                    (xmax <> 0 AND updated_at = now()) AS changed
        )
        SELECT CASE WHEN inserted THEN 'inserted' WHEN changed THEN 'updated' ELSE 'unchanged' END AS action FROM upsert
      `);
      const action = result[0]?.action ?? 'unchanged';
      if (action === 'inserted') s.inserted++;
      else if (action === 'updated') s.updated++;
      else s.unchanged++;
    }
    summary[kind] = s;
  }
  return summary;
}

if (process.argv[1] && /geo-import/.test(process.argv[1])) {
  importGeo()
    .then(async (summary) => {
      for (const [kind, s] of Object.entries(summary)) {
        console.log(`${kind}: ${s.inserted} nuevos, ${s.updated} actualizados, ${s.unchanged} sin cambios`);
      }
      await sqlClient.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
