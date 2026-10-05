import { eq, sql } from 'drizzle-orm';
import type { MultiPolygon, Polygon } from 'geojson';
import type { DbOrTx } from '@/db/client';
import { polygons } from '@/db/schema';
import type { PolygonKind } from '@/shared/constants';
import type { PolygonStatsQuery, UpdatePolygonInput } from '@/shared/schemas/polygons';
import type { PolygonDetail, PolygonFeatureCollection, PolygonStat } from '@/shared/types';
import type { Actor } from '../auth/session';
import { NotFoundError } from '../errors';
import * as attachmentsService from './attachments';
import * as audit from './audit';

/**
 * Polígonos de referencia (§7.9). La geometría no se edita desde la app; se re-importa con `geo:import`.
 * Las consultas espaciales usan `ST_Covers(polygons.geom, records.geom)` sobre la columna generada `records.geom` (§5.8).
 */

export type PolygonsListResult = {
  collection: PolygonFeatureCollection;
  /** ETag débil derivado de `max(updated_at)` y la cantidad de polígonos del tipo. */
  etag: string;
};

type ListRow = {
  id: number;
  kind: PolygonKind;
  name: string | null;
  code: string | null;
  geometry: Polygon | MultiPolygon;
  total: number;
  max_updated: string | Date | null;
};

export async function listPolygons(db: DbOrTx, kind: PolygonKind): Promise<PolygonsListResult> {
  const rows = await db.execute<ListRow>(sql`
    SELECT id, kind, name, code,
           ST_AsGeoJSON(geom)::json AS geometry,
           count(*) OVER ()::int AS total,
           max(updated_at) OVER () AS max_updated
    FROM ${polygons}
    WHERE kind = ${kind}::polygon_kind
    ORDER BY id
  `);

  const first = rows[0];
  const maxUpdated = first?.max_updated ? new Date(first.max_updated).getTime() : 0;
  const etag = `W/"polygons-${kind}-${first?.total ?? 0}-${maxUpdated}"`;

  return {
    etag,
    collection: {
      type: 'FeatureCollection',
      features: rows.map((r) => ({
        type: 'Feature',
        id: r.id,
        geometry: r.geometry,
        properties: { id: r.id, kind: r.kind, name: r.name, code: r.code },
      })),
    },
  };
}

type DetailRow = {
  id: number;
  kind: PolygonKind;
  code: string | null;
  name: string | null;
  properties: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
  xmin: number | null;
  ymin: number | null;
  xmax: number | null;
  ymax: number | null;
  cx: number | null;
  cy: number | null;
};

type CountRow = { layer_id: number; layer_name: string; icon: string; icon_color: string; count: number };

export async function getPolygon(db: DbOrTx, id: number): Promise<PolygonDetail> {
  const [row] = await db.execute<DetailRow>(sql`
    SELECT id, kind, code, name, properties, created_at, updated_at,
           ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax,
           ST_X(ST_PointOnSurface(geom)) AS cx, ST_Y(ST_PointOnSurface(geom)) AS cy
    FROM ${polygons}
    WHERE id = ${id}
    LIMIT 1
  `);
  if (!row) throw new NotFoundError('El polígono no existe');

  const [attachments, counts, sector] = await Promise.all([
    attachmentsService.listAttachments(db, 'polygon', String(id)),
    db.execute<CountRow>(sql`
      SELECT l.id AS layer_id, l.name AS layer_name, l.icon, l.icon_color, count(r.id)::int AS count
      FROM polygons p
      JOIN records r ON r.geom IS NOT NULL AND ST_Covers(p.geom, r.geom)
      JOIN layers l ON l.id = r.layer_id
      WHERE p.id = ${id}
      GROUP BY l.id, l.name, l.icon, l.icon_color, l.department, l.sort_order
      ORDER BY l.department, l.sort_order, l.name
    `),
    row.kind === 'villa'
      ? db.execute<{ id: number; name: string | null }>(sql`
          SELECT s.id, s.name
          FROM polygons v
          JOIN polygons s ON s.kind = 'sector' AND ST_Intersects(s.geom, v.geom)
          WHERE v.id = ${id}
          ORDER BY ST_Area(ST_Intersection(s.geom, v.geom)) DESC, s.id
          LIMIT 1
        `)
      : Promise.resolve(null),
  ]);

  const hasBbox = row.xmin !== null && row.ymin !== null && row.xmax !== null && row.ymax !== null;

  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    name: row.name,
    properties: row.properties ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    attachments: attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    counts: counts.map((c) => ({
      layerId: c.layer_id,
      layerName: c.layer_name,
      icon: c.icon,
      iconColor: c.icon_color,
      count: Number(c.count),
    })),
    sector: row.kind === 'villa' ? (sector?.[0] ? { id: sector[0].id, name: sector[0].name } : null) : undefined,
    bbox: hasBbox ? [Number(row.xmin), Number(row.ymin), Number(row.xmax), Number(row.ymax)] : null,
    centroid: row.cx !== null && row.cy !== null ? { lat: Number(row.cy), lon: Number(row.cx) } : null,
  };
}

/** Edita nombre y/o propiedades (editor/admin). Audita `UPDATE POLYGON` con `before/after`. */
export async function updatePolygon(db: DbOrTx, actor: Actor, id: number, patch: UpdatePolygonInput): Promise<PolygonDetail> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(polygons).where(eq(polygons.id, id)).limit(1);
    if (!before) throw new NotFoundError('El polígono no existe');

    const set: Partial<typeof polygons.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.properties !== undefined) set.properties = patch.properties;
    if (Object.keys(set).length === 0) return;

    const [after] = await tx.update(polygons).set(set).where(eq(polygons.id, id)).returning();
    const { before: b, after: a } = audit.diff(
      { name: before.name, properties: before.properties },
      { name: after!.name, properties: after!.properties },
    );
    await audit.log(tx, {
      actor,
      action: 'UPDATE',
      entityType: 'POLYGON',
      entityId: id,
      metadata: { kind: before.kind, before: b, after: a },
    });
  });
  return getPolygon(db, id);
}

type StatRow = { polygon_id: number; name: string | null; count: number };

/** Conteo de registros de una capa por polígono de un tipo, en una sola consulta (incluye los que tienen 0). */
export async function getPolygonStats(db: DbOrTx, q: PolygonStatsQuery): Promise<PolygonStat[]> {
  const rows = await db.execute<StatRow>(sql`
    SELECT p.id AS polygon_id, p.name, count(r.id)::int AS count
    FROM polygons p
    LEFT JOIN records r ON r.layer_id = ${q.layerId} AND r.geom IS NOT NULL AND ST_Covers(p.geom, r.geom)
    WHERE p.kind = ${q.kind}::polygon_kind
    GROUP BY p.id, p.name
    ORDER BY count DESC, p.id
  `);
  return rows.map((r) => ({ polygonId: r.polygon_id, name: r.name, count: Number(r.count) }));
}
