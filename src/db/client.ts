import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/env';
import { capabilities } from '@/shared/capabilities';
import * as schema from './schema';

declare global {
  var __sigdomSql: ReturnType<typeof postgres> | undefined;
}

// Staging (Vercel + pooler de Neon): cada instancia serverless abre su propio pool, así que va pequeño.
const poolMax = capabilities.mode === 'staging' ? 2 : env.NODE_ENV === 'production' ? 10 : 5;

// En desarrollo Next recarga módulos: reutilizamos la conexión para no agotar el pool.
const client =
  globalThis.__sigdomSql ??
  postgres(env.DATABASE_URL, {
    max: poolMax,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

if (env.NODE_ENV !== 'production') globalThis.__sigdomSql = client;

export const db = drizzle(client, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export { client as sqlClient };
