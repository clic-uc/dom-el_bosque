import { sql } from 'drizzle-orm';
import { date, doublePrecision, index, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestamps } from './common';

/** Rol SII (§5.3). `id` normalizado 'NNNNN-NNNNN'. */
export const roles = pgTable(
  'roles',
  {
    id: varchar('id', { length: 11 }).primaryKey(),
    lat: doublePrecision('lat'), // ubicación de referencia del predio (padrón); el mapa NO la lee (§8.3)
    lon: doublePrecision('lon'),
    address: text('address'), // DIRECCION + COMPLEMENTO del padrón, tal cual
    addressNorm: text('address_norm'), // normalizeAddress(address) (§8.7)
    streetNorm: text('street_norm'), // calle normalizada, sin número
    houseNumber: integer('house_number'),
    supersededAt: date('superseded_at'), // NULL = vigente (§8.9)
    ...timestamps,
  },
  (t) => [
    index('roles_address_norm_trgm').using('gin', sql`${t.addressNorm} gin_trgm_ops`),
    index('roles_street_number_idx').on(t.streetNorm, t.houseNumber),
  ],
);
