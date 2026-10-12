import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt } from './common';
import { bytea } from './custom-types';

/**
 * Archivos guardados en la base (backend `database` de `src/server/storage.ts`). Solo se usa en staging
 * (Vercel no tiene disco persistente); en producción la tabla queda vacía. Claves iguales a las del disco.
 */
export const fileBlobs = pgTable('file_blobs', {
  key: text('key').primaryKey(),
  data: bytea('data').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt,
});
