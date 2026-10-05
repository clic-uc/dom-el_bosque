/**
 * Conversión única de los polígonos del legacy a GeoJSON estándar (§10.5).
 *
 *   pnpm geo:convert [ruta-a-website-el-bosque/src/data]
 *
 * - poligono_comuna.geojson.js → data/geo/comuna.geojson (quitar `export const Comuna =`)
 * - poligonos_sectores.geojson.js y poligonos_villas_poblaciones.geojson.js: formato propio
 *   `features[].{ id, type: 'poly', coordinates: [[ [lat, lon], ... ]] }` con coordenadas invertidas
 *   → FeatureCollection<Polygon> con [lon, lat], properties { id, name? }; villas simplificadas con turf.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import simplify from '@turf/simplify';
import type { Feature, FeatureCollection, Polygon } from 'geojson';

const srcDir = process.argv[2] ?? path.resolve(process.cwd(), '../sigdom legacy/website-el-bosque/src/data');
const outDir = path.resolve(process.cwd(), 'data/geo');

type LegacyFeature = {
  id: string | number;
  type: string;
  layerId?: string;
  name?: string;
  properties?: Record<string, unknown>;
  coordinates: number[][][];
};

function parseJsModule(text: string): unknown {
  // `export const X = {...};` es un literal JS (con comas finales), no JSON estricto: lo evaluamos.
  const body = text.replace(/^\s*export\s+const\s+\w+\s*=\s*/, 'return ');
  return new Function(body)() as unknown;
}

function closeRing(ring: number[][]): number[][] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) return [...ring, first];
  return ring;
}

function convertLegacy(data: { features: LegacyFeature[] }, simplifyTolerance?: number): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = data.features
    .filter((f) => Array.isArray(f.coordinates) && f.coordinates.length > 0)
    .map((f) => {
      const rings = f.coordinates.map((ring) => closeRing(ring.map(([lat, lon]) => [lon!, lat!])));
      const feature: Feature<Polygon> = {
        type: 'Feature',
        id: String(f.id),
        properties: { id: String(f.id), ...(f.name ? { name: f.name } : {}), ...(f.properties ?? {}) },
        geometry: { type: 'Polygon', coordinates: rings },
      };
      if (simplifyTolerance) {
        try {
          return simplify(feature, { tolerance: simplifyTolerance, highQuality: true, mutate: false });
        } catch {
          return feature;
        }
      }
      return feature;
    });
  return { type: 'FeatureCollection', features };
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const comunaRaw = parseJsModule(await readFile(path.join(srcDir, 'poligono_comuna.geojson.js'), 'utf8')) as FeatureCollection;
  const comuna: FeatureCollection = {
    type: 'FeatureCollection',
    features: comunaRaw.features.map((f, i) => ({
      ...f,
      id: String(f.id ?? (f.properties as Record<string, unknown> | null)?.['@id'] ?? i),
      properties: {
        ...(f.properties ?? {}),
        id: String(f.id ?? (f.properties as Record<string, unknown> | null)?.['@id'] ?? i),
        name: (f.properties as Record<string, unknown> | null)?.name ?? 'El Bosque',
      },
    })),
  };
  await writeFile(path.join(outDir, 'comuna.geojson'), JSON.stringify(comuna));
  console.log(`comuna.geojson: ${comuna.features.length} feature(s)`);

  const sectoresRaw = parseJsModule(await readFile(path.join(srcDir, 'poligonos_sectores.geojson.js'), 'utf8')) as {
    features: LegacyFeature[];
  };
  const sectores = convertLegacy(sectoresRaw);
  await writeFile(path.join(outDir, 'sectores.geojson'), JSON.stringify(sectores));
  console.log(`sectores.geojson: ${sectores.features.length} polígonos`);

  const villasRaw = parseJsModule(
    await readFile(path.join(srcDir, 'poligonos_villas_poblaciones.geojson.js'), 'utf8'),
  ) as { features: LegacyFeature[] };
  const villas = convertLegacy(villasRaw, 0.00001);
  const out = JSON.stringify(villas);
  await writeFile(path.join(outDir, 'villas-poblaciones.geojson'), out);
  console.log(`villas-poblaciones.geojson: ${villas.features.length} polígonos, ${(out.length / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
