import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { fileBlobs } from '@/db/schema';
import { env } from '@/env';
import { capabilities } from '@/shared/capabilities';

/**
 * Almacenamiento de archivos detrás de una interfaz mínima (§2). Claves tipo `attachments/<uuid>`
 * o `imports/<id>`. Nunca se aceptan rutas absolutas ni `..`.
 * Dos backends: disco local (producción) y la tabla `file_blobs` (staging en Vercel, sin disco persistente).
 */
export type Storage = {
  put(key: string, data: Buffer | Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Stream web para respuestas HTTP de descarga. */
  getStream(key: string): ReadableStream<Uint8Array>;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  deleteMany(keys: Iterable<string>): Promise<void>;
};

function assertKey(key: string): void {
  if (!/^[a-zA-Z0-9_\-./]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`Clave de storage inválida: ${key}`);
  }
}

// En el build de Next se omite la validación de env (SKIP_ENV_VALIDATION): usamos el valor por defecto.
const ROOT = path.resolve(process.cwd(), env.STORAGE_DIR || './storage');

function resolveKey(key: string): string {
  assertKey(key);
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT)) throw new Error(`Clave de storage fuera del directorio: ${key}`);
  return full;
}

export const diskStorage: Storage & { root: string } = {
  root: ROOT,

  async put(key, data) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  },

  async get(key) {
    return readFile(resolveKey(key));
  },

  getStream(key) {
    const nodeStream = createReadStream(resolveKey(key));
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  },

  async exists(key) {
    try {
      await stat(resolveKey(key));
      return true;
    } catch {
      return false;
    }
  },

  async size(key) {
    try {
      return (await stat(resolveKey(key))).size;
    } catch {
      return null;
    }
  },

  async delete(key) {
    await rm(resolveKey(key), { force: true });
  },

  async deleteMany(keys) {
    for (const k of keys) await diskStorage.delete(k);
  },
};

/** Backend en Postgres: el análisis y la confirmación son peticiones distintas y `/tmp` no se comparte entre instancias. */
export const databaseStorage: Storage = {
  async put(key, data) {
    assertKey(key);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await db
      .insert(fileBlobs)
      .values({ key, data: buffer, sizeBytes: buffer.byteLength })
      .onConflictDoUpdate({
        target: fileBlobs.key,
        set: { data: buffer, sizeBytes: buffer.byteLength, createdAt: sql`now()` },
      });
  },

  async get(key) {
    assertKey(key);
    const [row] = await db.select({ data: fileBlobs.data }).from(fileBlobs).where(eq(fileBlobs.key, key)).limit(1);
    // Mismo comportamiento que readFile con un archivo inexistente.
    if (!row) throw Object.assign(new Error(`ENOENT: archivo no encontrado: ${key}`), { code: 'ENOENT' });
    return Buffer.from(row.data);
  },

  getStream(key) {
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(new Uint8Array(await databaseStorage.get(key)));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  },

  async exists(key) {
    return (await databaseStorage.size(key)) !== null;
  },

  async size(key) {
    assertKey(key);
    const [row] = await db
      .select({ size: fileBlobs.sizeBytes })
      .from(fileBlobs)
      .where(eq(fileBlobs.key, key))
      .limit(1);
    return row ? row.size : null;
  },

  async delete(key) {
    assertKey(key);
    await db.delete(fileBlobs).where(eq(fileBlobs.key, key));
  },

  async deleteMany(keys) {
    const list = [...keys];
    list.forEach(assertKey);
    if (list.length) await db.delete(fileBlobs).where(inArray(fileBlobs.key, list));
  },
};

export const storage: Storage = capabilities.fileStorage === 'database' ? databaseStorage : diskStorage;
