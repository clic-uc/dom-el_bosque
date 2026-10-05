import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditLogs } from '@/db/schema';
import type { AuditAction, AuditEntity } from '@/shared/constants';
import type { AuditLogsQuery } from '@/shared/schemas/audit';
import type { Paginated } from '@/shared/schemas/common';
import type { Actor } from '../auth/session';

export type AuditInput = {
  actor: Pick<Actor, 'userId' | 'email'>;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string | number;
  layerId?: number | null;
  metadata?: Record<string, unknown> | null;
};

/** Escribe un log dentro de la transacción de la mutación (§7). Nunca guardar contraseñas en `metadata`. */
export async function log(tx: DbOrTx, input: AuditInput): Promise<void> {
  await tx.insert(auditLogs).values({
    userId: input.actor.userId,
    userEmail: input.actor.email,
    action: input.action,
    entityType: input.entityType,
    entityId: String(input.entityId),
    layerId: input.layerId ?? null,
    metadata: input.metadata ?? null,
  });
}

export type AuditLogRow = typeof auditLogs.$inferSelect;

/** Admin ve todo; otros roles siempre filtran por el propio usuario (§7.7). */
export async function listLogs(
  db: DbOrTx,
  actor: Actor,
  q: AuditLogsQuery,
): Promise<Paginated<AuditLogRow>> {
  const conds: SQL[] = [];
  const userId = actor.role === 'admin' ? q.userId : actor.userId;
  if (userId) conds.push(eq(auditLogs.userId, userId));
  if (q.action) conds.push(eq(auditLogs.action, q.action));
  if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
  if (q.layerId) conds.push(eq(auditLogs.layerId, q.layerId));
  if (q.from) conds.push(gte(auditLogs.createdAt, new Date(`${q.from}T00:00:00`)));
  if (q.to) conds.push(lte(auditLogs.createdAt, new Date(`${q.to}T23:59:59.999`)));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);

  return { data: rows, total: Number(totals[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
}

/** Diferencia superficial `before/after` solo con las claves que cambiaron, para `metadata` de UPDATE. */
export function diff<T extends Record<string, unknown>>(before: T, after: T): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof T>;
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}
