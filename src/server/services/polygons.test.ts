import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sqlClient } from '@/db/client';
import { auditLogs, layers, polygons, records } from '@/db/schema';
import type { Actor } from '../auth/session';
import { NotFoundError } from '../errors';
import { importGeo } from '../../../scripts/geo-import';
import * as polygonsService from './polygons';

/** Tests con BD real: carga data/geo con `importGeo` y verifica conteos contra un cálculo de referencia. */

const actor: Actor = { userId: 'u-test', email: 'editor@test.cl', name: 'Editor', role: 'editor', rawRole: 'editor', mustChangePassword: false };

type Pt = { lon: number; lat: number };

async function pointOnSurface(polygonId: number): Promise<Pt> {
  const [row] = await db.execute<{ lon: number; lat: number }>(sql`
    SELECT ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat FROM polygons WHERE id = ${polygonId}
  `);
  return { lon: Number(row!.lon), lat: Number(row!.lat) };
}

async function insertRecord(layerId: number, pt: Pt | null) {
  const [row] = await db
    .insert(records)
    .values({
      layerId,
      lat: pt?.lat ?? null,
      lon: pt?.lon ?? null,
      coordsSource: pt ? 'own' : null,
      attributes: {},
    })
    .returning({ id: records.id });
  return row!.id;
}

async function createLayer(name: string, sortOrder: number) {
  const [row] = await db
    .insert(layers)
    .values({ slug: name.toLowerCase().replace(/\s+/g, '-'), name, department: 'edificacion', icon: 'hammer', iconColor: '#111111', sortOrder })
    .returning();
  return row!;
}

/** Coordenada muy lejos de la comuna (Océano Pacífico). */
const FAR: Pt = { lon: -72.5, lat: -33.0 };

describe('polygons.service', () => {
  let sectorIds: number[] = [];

  beforeAll(async () => {
    await db.execute(sql`TRUNCATE polygons, records, layers, attachments, audit_logs RESTART IDENTITY CASCADE`);
    const summary = await importGeo();
    expect(summary.sector?.inserted).toBe(7);
    expect(summary.comuna?.inserted).toBe(1);
    expect(summary.villa?.inserted).toBeGreaterThan(100);
    const rows = await db.select({ id: polygons.id }).from(polygons).where(eq(polygons.kind, 'sector')).orderBy(polygons.id);
    sectorIds = rows.map((r) => r.id);
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE records, layers, attachments, audit_logs RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  it('listPolygons devuelve un FeatureCollection con propiedades mínimas y un ETag estable', async () => {
    const a = await polygonsService.listPolygons(db, 'sector');
    expect(a.collection.type).toBe('FeatureCollection');
    expect(a.collection.features).toHaveLength(7);
    const f = a.collection.features[0]!;
    expect(f.geometry.type).toBe('MultiPolygon');
    expect(f.properties).toEqual({ id: f.id, kind: 'sector', name: null, code: expect.any(String) });
    expect(a.etag).toMatch(/^W\/"polygons-sector-7-\d+"$/);

    const b = await polygonsService.listPolygons(db, 'sector');
    expect(b.etag).toBe(a.etag);

    // editar un polígono cambia el ETag
    await polygonsService.updatePolygon(db, actor, sectorIds[0]!, { name: 'Sector Norte' });
    const c = await polygonsService.listPolygons(db, 'sector');
    expect(c.etag).not.toBe(a.etag);
    expect(c.collection.features.find((x) => x.id === sectorIds[0])?.properties.name).toBe('Sector Norte');

    const comuna = await polygonsService.listPolygons(db, 'comuna');
    expect(comuna.collection.features).toHaveLength(1);
    expect(comuna.collection.features[0]?.properties.name).toBe('El Bosque');
  });

  it('getPolygon cuenta registros por capa con ST_Covers (solo capas con ≥1) y entrega bbox/centroide', async () => {
    const [s1, s2] = sectorIds as [number, number];
    const inside1 = await pointOnSurface(s1);
    const inside2 = await pointOnSurface(s2);

    const obras = await createLayer('Obras Menores', 0);
    const calzadas = await createLayer('Calzadas', 1);
    const vacia = await createLayer('Sin registros dentro', 2);

    // referencia: 3 de obras dentro del sector 1, 2 fuera; 1 de calzadas dentro; 1 de calzadas en el sector 2; capa vacía con 1 lejos y 1 sin coordenadas
    await insertRecord(obras.id, inside1);
    await insertRecord(obras.id, inside1);
    await insertRecord(obras.id, { lon: inside1.lon + 0.00001, lat: inside1.lat + 0.00001 });
    await insertRecord(obras.id, FAR);
    await insertRecord(obras.id, null);
    await insertRecord(calzadas.id, inside1);
    await insertRecord(calzadas.id, inside2);
    await insertRecord(vacia.id, FAR);
    await insertRecord(vacia.id, null);

    // cálculo de referencia independiente (bbox + ST_Within sobre los puntos)
    const [ref] = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM records r, polygons p
      WHERE p.id = ${s1} AND r.layer_id = ${obras.id} AND r.geom IS NOT NULL AND ST_Within(r.geom, p.geom)
    `);
    expect(Number(ref!.n)).toBe(3);

    const detail = await polygonsService.getPolygon(db, s1);
    expect(detail.kind).toBe('sector');
    expect(detail.counts).toEqual([
      { layerId: obras.id, layerName: 'Obras Menores', icon: 'hammer', iconColor: '#111111', count: 3 },
      { layerId: calzadas.id, layerName: 'Calzadas', icon: 'hammer', iconColor: '#111111', count: 1 },
    ]);
    expect(detail.attachments).toEqual([]);
    expect(detail.sector).toBeUndefined();
    expect(detail.bbox).not.toBeNull();
    const [xmin, ymin, xmax, ymax] = detail.bbox!;
    expect(xmin).toBeLessThan(xmax);
    expect(ymin).toBeLessThan(ymax);
    expect(detail.centroid).toEqual({ lon: inside1.lon, lat: inside1.lat });
    expect(detail.centroid!.lon).toBeGreaterThan(xmin);
    expect(detail.centroid!.lon).toBeLessThan(xmax);

    await expect(polygonsService.getPolygon(db, 999_999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getPolygonStats agrupa en una sola consulta y ordena por cantidad descendente', async () => {
    const [s1, s2, s3] = sectorIds as [number, number, number];
    const layer = await createLayer('Obras Menores', 0);
    const other = await createLayer('Otra capa', 1);
    const p1 = await pointOnSurface(s1);
    const p2 = await pointOnSurface(s2);
    const p3 = await pointOnSurface(s3);

    for (let i = 0; i < 4; i++) await insertRecord(layer.id, p2);
    for (let i = 0; i < 2; i++) await insertRecord(layer.id, p1);
    await insertRecord(layer.id, p3);
    await insertRecord(layer.id, FAR);
    await insertRecord(other.id, p1); // otra capa: no cuenta

    const stats = await polygonsService.getPolygonStats(db, { kind: 'sector', layerId: layer.id });
    expect(stats).toHaveLength(7);
    expect(stats.slice(0, 3).map((s) => [s.polygonId, s.count])).toEqual([
      [s2, 4],
      [s1, 2],
      [s3, 1],
    ]);
    expect(stats.slice(3).every((s) => s.count === 0)).toBe(true);
    expect(stats.reduce((acc, s) => acc + s.count, 0)).toBe(7);

    const comuna = await polygonsService.getPolygonStats(db, { kind: 'comuna', layerId: layer.id });
    expect(comuna).toHaveLength(1);
    expect(comuna[0]?.count).toBe(7); // todos los puntos de los sectores están dentro de la comuna; el lejano no
  });

  it('getPolygon de una villa indica el sector que más la cubre', async () => {
    // referencia: una villa totalmente cubierta por un sector → ese sector debe ser el resultado
    const [pair] = await db.execute<{ villa_id: number; sector_id: number }>(sql`
      SELECT v.id AS villa_id, s.id AS sector_id
      FROM polygons v JOIN polygons s ON s.kind = 'sector' AND ST_Covers(s.geom, v.geom)
      WHERE v.kind = 'villa'
      ORDER BY v.id LIMIT 1
    `);
    expect(pair).toBeDefined();
    const detail = await polygonsService.getPolygon(db, pair!.villa_id);
    expect(detail.kind).toBe('villa');
    expect(detail.sector).toEqual({ id: pair!.sector_id, name: null });
  });

  it('updatePolygon cambia nombre/propiedades y audita UPDATE POLYGON con before/after', async () => {
    const id = sectorIds[1]!;
    const updated = await polygonsService.updatePolygon(db, actor, id, { name: 'Sector Centro', properties: { zona: 'B' } });
    expect(updated.name).toBe('Sector Centro');
    expect(updated.properties).toMatchObject({ zona: 'B' });

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'POLYGON'));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe('UPDATE');
    expect(logs[0]?.entityId).toBe(String(id));
    expect(logs[0]?.userId).toBe('u-test');
    expect(logs[0]?.metadata).toMatchObject({ kind: 'sector', before: { name: null }, after: { name: 'Sector Centro' } });

    await expect(polygonsService.updatePolygon(db, actor, 999_999, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
