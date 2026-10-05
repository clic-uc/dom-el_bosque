import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { records, roleOperationRoles, roleOperations, roles } from '@/db/schema';
import { roleOperationTypeLabels, type RoleOperationType } from '@/shared/constants';
import { tryNormalizeRoleId } from '@/shared/role-id';
import type { Paginated } from '@/shared/schemas/common';
import { roleOperationCardinality, type CreateRoleOperationData, type RoleOperationsQuery } from '@/shared/schemas/roles';
import type { RoleOperationDto } from '@/shared/types';
import { formatDate } from '@/lib/format';
import type { Actor } from '../auth/session';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import * as audit from './audit';
import { propagateRoleCoordinates } from './coordinates';
import { ensureRoles, loadOperationsByIds } from './roles';

/**
 * Operaciones sobre roles (§7.11 / §8.9). Funciona como un historial de migraciones: cada operación se
 * agrega y enlaza roles de origen con roles resultantes; nunca se reescriben registros ni se renombran roles.
 *
 *   Subdivisión   1 origen  → 2+ resultantes   (origen deja de estar vigente)
 *   Fusión        2+ origen → 1 resultante     (orígenes dejan de estar vigentes)
 *   Rectificación 1 origen  → 1 resultante     (origen deja de estar vigente)
 *   Modificación  1+ origen → ninguno          (siguen vigentes; anotación)
 */

const SUPERSEDING_TYPES: readonly RoleOperationType[] = ['subdivision', 'fusion', 'rectificacion'];

function normalizeList(raw: string[], side: 'origen' | 'resultante'): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const r = tryNormalizeRoleId(value);
    if (!r.ok || !r.value) {
      throw new ValidationError(
        `El rol ${side} "${value}" no es válido: debe tener el formato 00000-00000, solo con números`,
      );
    }
    if (!out.includes(r.value)) out.push(r.value);
  }
  return out;
}

/** Revalida la cantidad de roles por tipo tras normalizar y quitar repetidos (§8.9). */
function assertCardinality(type: RoleOperationType, originCount: number, resultCount: number): void {
  const rule = roleOperationCardinality[type];
  const label = roleOperationTypeLabels[type];
  const [oMin, oMax] = rule.origin;
  const [rMin, rMax] = rule.result;
  if (originCount < oMin || (oMax !== null && originCount > oMax)) {
    throw new ValidationError(
      oMax === oMin
        ? `Una ${label.toLowerCase()} lleva exactamente ${oMin} rol de origen (sin repetir)`
        : `Una ${label.toLowerCase()} lleva al menos ${oMin} roles de origen distintos`,
    );
  }
  if (resultCount < rMin || (rMax !== null && resultCount > rMax)) {
    throw new ValidationError(
      rMax === 0
        ? 'Una modificación no tiene roles resultantes'
        : rMax === rMin
          ? `Una ${label.toLowerCase()} lleva exactamente ${rMin} rol resultante`
          : `Una ${label.toLowerCase()} lleva al menos ${rMin} roles resultantes distintos`,
    );
  }
}

/**
 * `superseded_at` de un rol = fecha más antigua entre las operaciones de subdivisión, fusión o rectificación
 * donde es origen; NULL si no hay ninguna (vuelve a estar vigente). Se recalcula al crear o eliminar operaciones.
 */
export async function recalculateSupersededAt(tx: DbOrTx, roleIds: string[]): Promise<void> {
  const ids = [...new Set(roleIds)];
  if (ids.length === 0) return;
  await tx.execute(sql`
    UPDATE roles r
    SET superseded_at = (
          SELECT min(op.effective_date)
          FROM role_operation_roles ror
          JOIN role_operations op ON op.id = ror.operation_id
          WHERE ror.role_id = r.id AND ror.side = 'origin' AND op.type <> 'modificacion'
        ),
        updated_at = now()
    WHERE r.id IN ${ids}
  `);
}

async function loadOperation(db: DbOrTx, id: number): Promise<RoleOperationDto> {
  const [op] = await loadOperationsByIds(db, [id]);
  if (!op) throw new NotFoundError('La operación no existe o fue eliminada');
  return op;
}

/** Coordenadas provisionales para los resultantes: las del origen (1) o el promedio de los orígenes (fusión). */
function inheritedCoordinates(origins: { lat: number | null; lon: number | null }[]): { lat: number; lon: number } | null {
  const located = origins.filter((o): o is { lat: number; lon: number } => o.lat !== null && o.lon !== null);
  if (located.length === 0) return null;
  const lat = located.reduce((acc, o) => acc + o.lat, 0) / located.length;
  const lon = located.reduce((acc, o) => acc + o.lon, 0) / located.length;
  return { lat: Math.round(lat * 1_000_000) / 1_000_000, lon: Math.round(lon * 1_000_000) / 1_000_000 };
}

export async function createOperation(db: DbOrTx, actor: Actor, input: CreateRoleOperationData): Promise<RoleOperationDto> {
  const originRoleIds = normalizeList(input.originRoleIds, 'origen');
  const resultRoleIds = normalizeList(input.resultRoleIds, 'resultante');
  assertCardinality(input.type, originRoleIds.length, resultRoleIds.length);

  const both = originRoleIds.filter((id) => resultRoleIds.includes(id));
  if (both.length) {
    throw new ValidationError(`El rol ${both[0]} no puede ser de origen y resultante en la misma operación`);
  }

  const id = await db.transaction(async (tx) => {
    const originRows = await tx.select().from(roles).where(inArray(roles.id, originRoleIds));
    const missing = originRoleIds.filter((rid) => !originRows.some((r) => r.id === rid));
    if (missing.length) {
      throw new NotFoundError(
        `El rol de origen ${missing[0]} no está registrado en el sistema. Revisa el número o impórtalo con el padrón antes de registrar la operación.`,
      );
    }

    const superseded = originRows.filter((r) => r.supersededAt !== null);
    if (superseded.length) {
      const r = superseded[0]!;
      const replacements = await tx.execute<{ result: string }>(sql`
        SELECT DISTINCT res.role_id AS result
        FROM role_operation_roles o
        JOIN role_operations op ON op.id = o.operation_id AND op.type <> 'modificacion'
        JOIN role_operation_roles res ON res.operation_id = o.operation_id AND res.side = 'result'
        WHERE o.side = 'origin' AND o.role_id = ${r.id}
        ORDER BY 1
      `);
      const by = replacements.map((x) => x.result).join(', ');
      throw new ConflictError(
        `El rol ${r.id} ya no está vigente desde el ${formatDate(r.supersededAt)}${by ? ` (fue reemplazado por ${by})` : ''}. ` +
          'No puede ser origen de otra operación: usa los roles resultantes o elimina primero la operación que lo reemplazó.',
        { roleId: r.id, supersededAt: r.supersededAt, resultRoleIds: replacements.map((x) => x.result) },
      );
    }

    if (input.recordId) {
      const [rec] = await tx.select({ id: records.id }).from(records).where(eq(records.id, input.recordId)).limit(1);
      if (!rec) throw new NotFoundError('El registro de respaldo no existe o fue eliminado');
    }

    if (resultRoleIds.length) await ensureRoles(tx, resultRoleIds);

    // Coordenadas provisionales para los resultantes que no las tengan (§8.9)
    let inherited: { lat: number; lon: number } | null = null;
    let inheritedTo: string[] = [];
    if (input.resultCoords === 'inherit' && resultRoleIds.length) {
      inherited = inheritedCoordinates(originRows);
      if (inherited) {
        const updated = await tx
          .update(roles)
          .set({ lat: inherited.lat, lon: inherited.lon })
          .where(and(inArray(roles.id, resultRoleIds), sql`${roles.lat} IS NULL`))
          .returning({ id: roles.id });
        inheritedTo = updated.map((u) => u.id);
        for (const rid of inheritedTo) await propagateRoleCoordinates(tx, rid, inherited.lat, inherited.lon);
      }
    }

    const [op] = await tx
      .insert(roleOperations)
      .values({
        type: input.type,
        effectiveDate: input.effectiveDate,
        reference: input.reference ?? null,
        recordId: input.recordId ?? null,
        comment: input.comment ?? null,
        createdBy: actor.userId,
      })
      .returning({ id: roleOperations.id });
    const opId = op!.id;

    await tx.insert(roleOperationRoles).values([
      ...originRoleIds.map((roleId) => ({ operationId: opId, roleId, side: 'origin' as const })),
      ...resultRoleIds.map((roleId) => ({ operationId: opId, roleId, side: 'result' as const })),
    ]);

    if (SUPERSEDING_TYPES.includes(input.type)) await recalculateSupersededAt(tx, originRoleIds);

    await audit.log(tx, {
      actor,
      action: 'CREATE',
      entityType: 'ROLE_OPERATION',
      entityId: opId,
      metadata: {
        type: input.type,
        effectiveDate: input.effectiveDate,
        reference: input.reference ?? null,
        recordId: input.recordId ?? null,
        originRoleIds,
        resultRoleIds,
        inheritedCoordsTo: inheritedTo,
      },
    });
    return opId;
  });

  return loadOperation(db, id);
}

/** Solo admin: borra una operación registrada por error. Los roles resultantes quedan (pueden tener registros). */
export async function deleteOperation(db: DbOrTx, actor: Actor, id: number, reason: string): Promise<void> {
  if (actor.role !== 'admin') {
    throw new ForbiddenError('Solo un administrador puede eliminar una operación sobre roles');
  }
  await db.transaction(async (tx) => {
    const [op] = await tx.select().from(roleOperations).where(eq(roleOperations.id, id)).limit(1);
    if (!op) throw new NotFoundError('La operación no existe o ya fue eliminada');
    const links = await tx.select().from(roleOperationRoles).where(eq(roleOperationRoles.operationId, id));
    const originRoleIds = links.filter((l) => l.side === 'origin').map((l) => l.roleId);
    const resultRoleIds = links.filter((l) => l.side === 'result').map((l) => l.roleId);

    await tx.delete(roleOperations).where(eq(roleOperations.id, id)); // cascade: role_operation_roles
    await recalculateSupersededAt(tx, originRoleIds);

    await audit.log(tx, {
      actor,
      action: 'DELETE',
      entityType: 'ROLE_OPERATION',
      entityId: id,
      metadata: {
        reason,
        type: op.type,
        effectiveDate: op.effectiveDate,
        reference: op.reference,
        recordId: op.recordId,
        originRoleIds,
        resultRoleIds,
      },
    });
  });
}

export async function listOperations(db: DbOrTx, q: RoleOperationsQuery): Promise<Paginated<RoleOperationDto>> {
  const conds: SQL[] = [];
  if (q.type) conds.push(eq(roleOperations.type, q.type));
  if (q.from) conds.push(gte(roleOperations.effectiveDate, q.from));
  if (q.to) conds.push(lte(roleOperations.effectiveDate, q.to));
  if (q.roleId !== undefined && q.roleId.trim() !== '') {
    const r = tryNormalizeRoleId(q.roleId);
    if (!r.ok || !r.value) {
      throw new ValidationError(`El rol "${q.roleId}" no es válido: debe tener el formato 00000-00000, solo con números`);
    }
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${roleOperationRoles} ror WHERE ror.operation_id = ${roleOperations.id} AND ror.role_id = ${r.value})`,
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const [idRows, totals] = await Promise.all([
    db
      .select({ id: roleOperations.id })
      .from(roleOperations)
      .where(where)
      .orderBy(desc(roleOperations.effectiveDate), desc(roleOperations.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(roleOperations).where(where),
  ]);

  const ids = idRows.map((r) => r.id);
  const loaded = await loadOperationsByIds(db, ids);
  const byId = new Map(loaded.map((o) => [o.id, o]));
  const data = ids.map((id) => byId.get(id)).filter((o): o is RoleOperationDto => !!o);
  return { data, total: Number(totals[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
}
