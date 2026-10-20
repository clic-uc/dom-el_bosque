import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';

export const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
// Reloj de la base, como el `updated_at = now()` del SQL directo y `committed_at` de las importaciones: con
// `new Date()` el reloj de la app y el de la base pueden diferir y "modificado después de importar" fallaba.
export const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => sql`now()`);

export const timestamps = { createdAt, updatedAt };
