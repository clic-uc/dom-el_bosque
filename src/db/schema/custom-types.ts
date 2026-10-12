import { customType } from 'drizzle-orm/pg-core';

/**
 * Tipos PostGIS no soportados nativamente por Drizzle (§2, §5.8).
 * Las geometrías nunca se escriben desde TS con valores: `records.geom` es una columna generada
 * y `polygons.geom` se escribe con SQL explícito (`ST_Multi(ST_GeomFromGeoJSON(...))`).
 * Al leer, el driver devuelve EWKB en hexadecimal; cuando se necesita GeoJSON se usa `ST_AsGeoJSON`.
 */
export const pointGeometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Point,4326)';
  },
});

export const multiPolygonGeometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(MultiPolygon,4326)';
  },
});

/** Binario (`bytea`). El driver `postgres` lee y escribe `Buffer`. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
