import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { env } from '@/env';

/**
 * Almacenamiento en disco local detrás de una interfaz mínima (§2). Claves tipo `attachments/<uuid>`
 * o `imports/<id>`. Nunca se aceptan rutas absolutas ni `..`.
 */

// En el build de Next se omite la validación de env (SKIP_ENV_VALIDATION): usamos el valor por defecto.
const ROOT = path.resolve(process.cwd(), env.STORAGE_DIR || './storage');

function resolveKey(key: string): string {
  if (!/^[a-zA-Z0-9_\-./]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`Clave de storage inválida: ${key}`);
  }
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT)) throw new Error(`Clave de storage fuera del directorio: ${key}`);
  return full;
}

export const storage = {
  root: ROOT,

  async put(key: string, data: Buffer | Uint8Array): Promise<void> {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  },

  async get(key: string): Promise<Buffer> {
    return readFile(resolveKey(key));
  },

  /** Stream web para respuestas HTTP de descarga. */
  getStream(key: string): ReadableStream<Uint8Array> {
    const nodeStream = createReadStream(resolveKey(key));
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  },

  async exists(key: string): Promise<boolean> {
    try {
      await stat(resolveKey(key));
      return true;
    } catch {
      return false;
    }
  },

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(resolveKey(key))).size;
    } catch {
      return null;
    }
  },

  async delete(key: string): Promise<void> {
    await rm(resolveKey(key), { force: true });
  },

  async deleteMany(keys: Iterable<string>): Promise<void> {
    for (const k of keys) await storage.delete(k);
  },
};

