import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { imports, layers } from '@/db/schema';
import type { Paginated } from '@/shared/schemas/common';
import type { ImportsQuery } from '@/shared/schemas/imports';
import type { ImportItem, Jsonified } from '@/shared/types';
import type { Actor } from '../auth/session';
import { ForbiddenError, NotFoundError } from '../errors';
import type { ImportRow } from './source';

/** Date → ISO string recursivamente (lo que ve el cliente tras `JSON.stringify`). */
export function jsonify<T>(value: T): Jsonified<T> {
  return JSON.parse(JSON.stringify(value)) as Jsonified<T>;
}

export function toImportItem(row: ImportRow, layerName?: string): ImportItem {
  return { ...jsonify(row), ...(layerName !== undefined ? { layerName } : {}) };
}

export async function requireImport(db: DbOrTx, id: string): Promise<ImportRow> {
  const [row] = await db.select().from(imports).where(eq(imports.id, id)).limit(1);
  if (!row) throw new NotFoundError('La importación no existe o fue eliminada');
  return row;
}

/** "(propia)": un editor solo opera sobre sus importaciones; un admin sobre todas (§9). */
export function assertOwnImport(actor: Pick<Actor, 'userId' | 'role'>, imp: Pick<ImportRow, 'userId'>): void {
  if (actor.role === 'admin') return;
  if (imp.userId !== actor.userId) {
    throw new ForbiddenError('Esta importación la hizo otra persona. Solo quien la subió o un administrador puede modificarla.');
  }
}

/** Actor mínimo para auditoría desde el worker (no hay sesión). */
export function workerActor(imp: Pick<ImportRow, 'userId' | 'userEmail'>): Pick<Actor, 'userId' | 'email'> {
  return { userId: imp.userId, email: imp.userEmail ?? '' };
}

/** Historial de importaciones (§7). Cualquier usuario autenticado puede listar; el filtro por usuario es solo para admin. */
export async function listImports(db: DbOrTx, actor: Actor, q: ImportsQuery): Promise<Paginated<ImportItem>> {
  const conds: SQL[] = [];
  if (q.layerId) conds.push(eq(imports.layerId, q.layerId));
  if (q.status) conds.push(eq(imports.status, q.status));
  if (q.userId && actor.role === 'admin') conds.push(eq(imports.userId, q.userId));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select({ imp: imports, layerName: layers.name })
      .from(imports)
      .innerJoin(layers, eq(layers.id, imports.layerId))
      .where(where)
      .orderBy(desc(imports.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(imports).where(where),
  ]);

  return {
    data: rows.map((r) => toImportItem(r.imp, r.layerName)),
    total: Number(totals[0]?.total ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  };
}
