import { and, asc, desc, eq, ilike, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@/db/client';
import { records, roleOperationRoles, roleOperations, roles } from '@/db/schema';
import { normalizeRoleId } from '@/shared/role-id';
import type { CreateRecordData, FeaturesQuery, RecordsQuery, UpdateRecordData } from '@/shared/schemas/records';
import type { Paginated } from '@/shared/schemas/common';
import type { RecordDetail, RecordFeature, RecordFeatureCollection, RoleDto } from '@/shared/types';
import type { Actor } from '../auth/session';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { getGeocoder } from '../geocoding';
import { castAttributes } from '../parsing/values';
import { attr, escapeLike, recordColumns, requireLayer, roleIdLikePatterns, type LayerRow, type RecordRowNoGeom } from './_shared';
import * as attachmentsService from './attachments';
import * as audit from './audit';
import { applyRoleChange, propagateRoleCoordinates, resolveCoordinatesForNew, roleAdoptCoordinates } from './coordinates';
import { assertNoDuplicate } from './duplicates';
import { invalidateFilterOptions } from './filters';
import { getAutonumberField } from './numbering';
import { ensureRole, getOperationsForRoles, getRole } from './roles';

// ---------- filtros comunes ----------

function buildWhere(
  layer: LayerRow,
  q: { search?: string; filters?: Record<string, string | string[]>; hasCoordinates?: boolean; coordsSource?: string; hasNumber?: boolean },
): SQL {
  const conds: SQL[] = [eq(records.layerId, layer.id)];

  if (q.search) {
    const like = `%${escapeLike(q.search)}%`;
    // "50-2" también encuentra el rol 00050-00002 (normalizado con ceros, §8.6)
    const rolePatterns = roleIdLikePatterns(q.search).map((p) => ilike(records.roleId, p));
    conds.push(
      or(
        ilike(records.roleId, like),
        ...rolePatterns,
        ilike(records.comments, like),
        sql`${records.attributes}::text ILIKE ${like}`,
      )!,
    );
  }

  const fieldKeys = new Set(layer.fields.map((f) => f.key));
  for (const [key, value] of Object.entries(q.filters ?? {})) {
    if (!fieldKeys.has(key)) continue;
    if (Array.isArray(value)) {
      const nonEmpty = value.filter((v) => v !== '');
      const parts: SQL[] = [];
      if (nonEmpty.length) parts.push(sql`${attr(key)} IN ${nonEmpty}`);
      if (value.includes('')) parts.push(sql`coalesce(${attr(key)}, '') = ''`);
      if (parts.length) conds.push(or(...parts)!);
    } else if (value !== '') {
      conds.push(sql`${attr(key)} ILIKE ${`${escapeLike(value)}%`}`);
    }
  }

  if (q.hasCoordinates === true) conds.push(isNotNull(records.lat));
  if (q.hasCoordinates === false) conds.push(isNull(records.lat));
  if (q.coordsSource) conds.push(eq(records.coordsSource, q.coordsSource as 'role' | 'own' | 'geocoded'));

  if (q.hasNumber !== undefined) {
    const auto = getAutonumberField(layer);
    if (auto) {
      conds.push(
        q.hasNumber
          ? sql`jsonb_typeof(${records.attributes}->${auto.key}) = 'number'`
          : sql`coalesce(jsonb_typeof(${records.attributes}->${auto.key}), 'null') <> 'number'`,
      );
    }
  }

  return and(...conds)!;
}

// ---------- GeoJSON (§7.3) ----------

export async function getFeatures(db: DbOrTx, layerId: number, q: FeaturesQuery): Promise<RecordFeatureCollection> {
  const layer = await requireLayer(db, layerId);
  const where = and(buildWhere(layer, q), isNotNull(records.lat))!;
  const hoverFields = layer.fields.slice(0, 3);
  const weightKey = q.weight && layer.heatmapFieldKey ? layer.heatmapFieldKey : null;

  const rows = await db
    .select({
      id: records.id,
      roleId: records.roleId,
      lat: records.lat,
      lon: records.lon,
      coordsSource: records.coordsSource,
      hover: sql<Record<string, unknown>>`${records.attributes} - ${sql.raw(
        `ARRAY[${layer.fields
          .filter((f) => !hoverFields.includes(f))
          .map((f) => `'${f.key.replace(/'/g, "''")}'`)
          .join(',') || "''"}]::text[]`,
      )}`,
      w: weightKey ? sql<number | null>`CASE WHEN jsonb_typeof(${records.attributes}->${weightKey}) = 'number' THEN (${records.attributes}->>${weightKey})::float END` : sql<null>`NULL`,
    })
    .from(records)
    .where(where);

  const features: RecordFeature[] = [];
  for (const r of rows) {
    if (weightKey && (r.w === null || r.w === undefined)) continue;
    features.push({
      type: 'Feature',
      id: r.id,
      geometry: { type: 'Point', coordinates: [r.lon!, r.lat!] },
      properties: {
        id: r.id,
        roleId: r.roleId,
        coordsSource: r.coordsSource!,
        ...(weightKey ? { w: Number(r.w) } : {}),
        ...r.hover,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// ---------- tabla paginada (§7.3) ----------

function sortExpr(layer: LayerRow, sort: string): SQL | AnyPgColumn {
  if (sort.startsWith('attr:')) {
    const key = sort.slice(5);
    const field = layer.fields.find((f) => f.key === key);
    if (!field) return records.updatedAt;
    if (field.type === 'number' || field.type === 'autonumber') {
      return sql`CASE WHEN jsonb_typeof(${records.attributes}->${key}) = 'number' THEN (${records.attributes}->>${key})::numeric END`;
    }
    return sql`${records.attributes}->>${key}`;
  }
  const map: Record<string, SQL | AnyPgColumn> = {
    id: records.id,
    roleId: records.roleId,
    lat: records.lat,
    lon: records.lon,
    updatedAt: records.updatedAt,
    createdAt: records.createdAt,
  };
  return map[sort] ?? records.updatedAt;
}

export async function listRecords(db: DbOrTx, layerId: number, q: RecordsQuery): Promise<Paginated<RecordRowNoGeom>> {
  const layer = await requireLayer(db, layerId);
  const where = buildWhere(layer, q);
  const expr = sortExpr(layer, q.sort);
  const order = q.dir === 'asc' ? sql`${expr} ASC NULLS LAST` : sql`${expr} DESC NULLS LAST`;

  const [rows, totals] = await Promise.all([
    db
      .select(recordColumns)
      .from(records)
      .where(where)
      .orderBy(order, asc(records.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(records).where(where),
  ]);
  return { data: rows, total: Number(totals[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
}

// ---------- detalle (§7.3) ----------

export async function getRecord(db: DbOrTx, id: number): Promise<RecordDetail> {
  const [rec] = await db.select(recordColumns).from(records).where(eq(records.id, id)).limit(1);
  if (!rec) throw new NotFoundError('El registro no existe o fue eliminado');
  const layer = await requireLayer(db, rec.layerId);

  const [role, attachments, sameRole, backing] = await Promise.all([
    rec.roleId ? getRole(db, rec.roleId).catch(() => null) : Promise.resolve<RoleDto | null>(null),
    attachmentsService.listAttachments(db, 'record', String(id)),
    rec.roleId
      ? db.select({ n: sql<number>`count(*)::int` }).from(records).where(and(eq(records.roleId, rec.roleId), ne(records.id, id)))
      : Promise.resolve([{ n: 0 }]),
    db
      .select({ id: roleOperations.id, type: roleOperations.type })
      .from(roleOperations)
      .where(eq(roleOperations.recordId, id))
      .limit(1),
  ]);

  let backsOperation: RecordDetail['backsOperation'] = null;
  if (backing[0]) {
    const origins = await db
      .select({ roleId: roleOperationRoles.roleId })
      .from(roleOperationRoles)
      .where(and(eq(roleOperationRoles.operationId, backing[0].id), eq(roleOperationRoles.side, 'origin')));
    backsOperation = { id: backing[0].id, type: backing[0].type, originRoleIds: origins.map((o) => o.roleId) };
  }

  let roleLastOperation: RecordDetail['roleLastOperation'] = null;
  if (role && !role.vigente) {
    const ops = await getOperationsForRoles(db, [role.id]);
    roleLastOperation = ops.filter((o) => o.originRoleIds.includes(role.id) && o.type !== 'modificacion').at(-1) ?? null;
  }

  return {
    ...rec,
    createdAt: rec.createdAt.toISOString(),
    updatedAt: rec.updatedAt.toISOString(),
    numberAssignedAt: rec.numberAssignedAt ? rec.numberAssignedAt.toISOString() : null,
    role,
    layer: {
      id: layer.id,
      name: layer.name,
      slug: layer.slug,
      hasRole: layer.hasRole,
      fields: layer.fields,
      uniqueKeys: layer.uniqueKeys,
      icon: layer.icon,
      iconColor: layer.iconColor,
      department: layer.department,
    },
    attachments,
    sameRoleCount: Number(sameRole[0]?.n ?? 0),
    backsOperation,
    roleLastOperation,
  };
}

// ---------- crear (§7.3) ----------

function requiredMissing(layer: LayerRow, attributes: Record<string, unknown>): string[] {
  return layer.fields
    .filter((f) => f.required && f.type !== 'autonumber')
    .filter((f) => attributes[f.key] === null || attributes[f.key] === undefined || attributes[f.key] === '')
    .map((f) => f.label);
}

function normalizeRoleInput(layer: LayerRow, roleId: string | null | undefined): string | null | undefined {
  if (!layer.hasRole) return null;
  if (roleId === undefined) return undefined;
  try {
    return normalizeRoleId(roleId);
  } catch {
    throw new ValidationError('El Rol SII debe tener el formato 00000-00000 (solo números)');
  }
}

export async function createRecord(db: DbOrTx, actor: Actor, input: CreateRecordData): Promise<RecordDetail> {
  const layer = await requireLayer(db, input.layerId);
  const cast = castAttributes(input.attributes, layer.fields);
  if (cast.errors.length) {
    const e = cast.errors[0]!;
    throw new ValidationError(`${e.label}: ${e.message}`, { errors: cast.errors });
  }
  const missing = requiredMissing(layer, cast.attributes);
  if (missing.length) throw new ValidationError(`Falta completar: ${missing.join(', ')}`, { missing });

  const roleId = normalizeRoleInput(layer, input.roleId ?? null) ?? null;
  const own = input.lat != null && input.lon != null ? { lat: input.lat, lon: input.lon } : null;
  const address = layer.addressFieldKey ? (cast.attributes[layer.addressFieldKey] as string | null | undefined) : null;

  const id = await db.transaction(async (tx) => {
    const role = roleId ? await ensureRole(tx, roleId) : null;
    const geocoder = getGeocoder(tx);
    const resolved = await resolveCoordinatesForNew({
      own,
      role,
      address: address ?? null,
      geocode: (a) => geocoder.geocode(a),
      layerHasRole: layer.hasRole,
    });
    const finalRoleId = roleId ?? resolved.roleAssignedByAddress ?? null;
    if (!roleId && resolved.roleAssignedByAddress) await ensureRole(tx, resolved.roleAssignedByAddress);

    await assertNoDuplicate(tx, layer, finalRoleId, cast.attributes);

    const [row] = await tx
      .insert(records)
      .values({
        layerId: layer.id,
        roleId: finalRoleId,
        lat: resolved.lat,
        lon: resolved.lon,
        coordsSource: resolved.coordsSource,
        geocode: resolved.geocode,
        attributes: cast.attributes,
        comments: input.comments ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: records.id });

    if (resolved.roleShouldAdopt && finalRoleId && resolved.lat !== null && resolved.lon !== null) {
      await roleAdoptCoordinates(tx, finalRoleId, resolved.lat, resolved.lon);
    }

    await audit.log(tx, {
      actor,
      action: 'CREATE',
      entityType: 'RECORD',
      entityId: row!.id,
      layerId: layer.id,
      metadata: { roleId: finalRoleId, coordsSource: resolved.coordsSource, attributes: cast.attributes },
    });
    return row!.id;
  });

  invalidateFilterOptions(layer.id);
  return getRecord(db, id);
}

// ---------- editar (§7.3) ----------

export async function updateRecord(db: DbOrTx, actor: Actor, id: number, patch: UpdateRecordData): Promise<RecordDetail> {
  const layerId = await db.transaction(async (tx) => {
    // Con `FOR UPDATE`: si se está asignando o corrigiendo el número del registro, se espera a que termine y se
    // parte de los atributos con el número. Sin el lock, el UPDATE de abajo esperaría igual, pero escribiría los
    // atributos leídos antes y borraría el número (`number_assigned_at` quedaría puesto).
    const [before] = await tx.select(recordColumns).from(records).where(eq(records.id, id)).limit(1).for('update');
    if (!before) throw new NotFoundError('El registro no existe o fue eliminado');
    const layer = await requireLayer(tx, before.layerId);

    const set: Partial<typeof records.$inferInsert> = { updatedBy: actor.userId };
    let attributes = before.attributes;

    if (patch.attributes !== undefined) {
      const cast = castAttributes(patch.attributes, layer.fields);
      if (cast.errors.length) {
        const e = cast.errors[0]!;
        throw new ValidationError(`${e.label}: ${e.message}`, { errors: cast.errors });
      }
      attributes = { ...before.attributes, ...cast.attributes };
      const missing = requiredMissing(layer, attributes);
      if (missing.length) throw new ValidationError(`Falta completar: ${missing.join(', ')}`, { missing });
      set.attributes = attributes;
    }
    if (patch.comments !== undefined) set.comments = patch.comments;

    let coords = { lat: before.lat, lon: before.lon, coordsSource: before.coordsSource, geocode: before.geocode };
    let roleId = before.roleId;
    const tookRoleCoords = { value: false };

    const newRoleId = normalizeRoleInput(layer, patch.roleId);
    if (newRoleId !== undefined && newRoleId !== before.roleId) {
      roleId = newRoleId;
      const newRole = newRoleId ? await ensureRole(tx, newRoleId) : null;
      const applied = applyRoleChange(coords, newRole);
      coords = { lat: applied.lat, lon: applied.lon, coordsSource: applied.coordsSource, geocode: applied.geocode };
      tookRoleCoords.value = applied.tookRoleCoords;
      set.roleId = roleId;
    }

    if (patch.lat !== undefined && patch.lon !== undefined) {
      if (patch.lat === null || patch.lon === null) {
        coords = { lat: null, lon: null, coordsSource: null, geocode: null };
      } else {
        coords = { lat: patch.lat, lon: patch.lon, coordsSource: 'own', geocode: null };
      }
    }
    if (coords.coordsSource === 'role' && !roleId) coords = { ...coords, coordsSource: 'own' };
    set.lat = coords.lat;
    set.lon = coords.lon;
    set.coordsSource = coords.coordsSource;
    set.geocode = coords.geocode;

    await assertNoDuplicate(tx, layer, roleId, attributes, id);

    const [after] = await tx.update(records).set(set).where(eq(records.id, id)).returning(recordColumns);

    // registro con coordenadas propias y rol sin coordenadas → el rol las adopta
    if (roleId && coords.coordsSource === 'own' && coords.lat !== null && coords.lon !== null) {
      await roleAdoptCoordinates(tx, roleId, coords.lat, coords.lon);
    }

    const { before: b, after: a } = audit.diff(
      { roleId: before.roleId, lat: before.lat, lon: before.lon, coordsSource: before.coordsSource, attributes: before.attributes, comments: before.comments },
      { roleId: after!.roleId, lat: after!.lat, lon: after!.lon, coordsSource: after!.coordsSource, attributes: after!.attributes, comments: after!.comments },
    );
    await audit.log(tx, {
      actor,
      action: 'UPDATE',
      entityType: 'RECORD',
      entityId: id,
      layerId: layer.id,
      metadata: { before: b, after: a, ...(tookRoleCoords.value ? { tookRoleCoords: true } : {}) },
    });
    return layer.id;
  });

  invalidateFilterOptions(layerId);
  return getRecord(db, id);
}

// ---------- coordenadas (§7.3 / §8.3) ----------

export async function updateCoordinates(
  db: DbOrTx,
  actor: Actor,
  id: number,
  input: { useRole: true } | { lat: number; lon: number; scope: 'record' | 'role' },
): Promise<{ updated: number }> {
  return db.transaction(async (tx) => {
    const [rec] = await tx.select(recordColumns).from(records).where(eq(records.id, id)).limit(1);
    if (!rec) throw new NotFoundError('El registro no existe o fue eliminado');

    if ('useRole' in input) {
      if (!rec.roleId) throw new ValidationError('Este registro no tiene rol');
      const [role] = await tx.select().from(roles).where(eq(roles.id, rec.roleId)).limit(1);
      if (!role || role.lat === null || role.lon === null) throw new ValidationError('El rol no tiene coordenadas de referencia');
      await tx
        .update(records)
        .set({ lat: role.lat, lon: role.lon, coordsSource: 'role', geocode: null, updatedBy: actor.userId })
        .where(eq(records.id, id));
      await audit.log(tx, {
        actor,
        action: 'UPDATE',
        entityType: 'RECORD',
        entityId: id,
        layerId: rec.layerId,
        metadata: { coordinates: 'useRole', before: { lat: rec.lat, lon: rec.lon, coordsSource: rec.coordsSource }, after: { lat: role.lat, lon: role.lon, coordsSource: 'role' } },
      });
      return { updated: 1 };
    }

    if (input.scope === 'role') {
      if (!rec.roleId) throw new ValidationError('Este registro no tiene rol: solo puedes mover este registro');
      await tx.update(roles).set({ lat: input.lat, lon: input.lon }).where(eq(roles.id, rec.roleId));
      // propaga a los registros 'role', 'geocoded' o sin coordenadas del rol (incluye al movido si era uno de ellos)
      let updated = await propagateRoleCoordinates(tx, rec.roleId, input.lat, input.lon);
      // el registro movido queda 'role' aunque fuera 'own' (no lo cubre la propagación)
      if (rec.coordsSource === 'own') {
        await tx
          .update(records)
          .set({ lat: input.lat, lon: input.lon, coordsSource: 'role', geocode: null, updatedBy: actor.userId })
          .where(eq(records.id, id));
        updated += 1;
      }
      await audit.log(tx, {
        actor,
        action: 'UPDATE',
        entityType: 'ROLE',
        entityId: rec.roleId,
        layerId: rec.layerId,
        metadata: { coordinates: 'scope=role', fromRecordId: id, lat: input.lat, lon: input.lon, updatedRecords: updated },
      });
      return { updated };
    }

    await tx
      .update(records)
      .set({ lat: input.lat, lon: input.lon, coordsSource: 'own', geocode: null, updatedBy: actor.userId })
      .where(eq(records.id, id));
    if (rec.roleId) await roleAdoptCoordinates(tx, rec.roleId, input.lat, input.lon);
    await audit.log(tx, {
      actor,
      action: 'UPDATE',
      entityType: 'RECORD',
      entityId: id,
      layerId: rec.layerId,
      metadata: { coordinates: 'scope=record', before: { lat: rec.lat, lon: rec.lon, coordsSource: rec.coordsSource }, after: { lat: input.lat, lon: input.lon, coordsSource: 'own' } },
    });
    return { updated: 1 };
  });
}

// ---------- borrar (§7.3) ----------

export async function deleteRecord(db: DbOrTx, actor: Actor, id: number, reason?: string): Promise<void> {
  const keys = await db.transaction(async (tx) => {
    const [rec] = await tx.select(recordColumns).from(records).where(eq(records.id, id)).limit(1);
    if (!rec) throw new NotFoundError('El registro no existe o fue eliminado');
    if (rec.numberAssignedAt && actor.role !== 'admin') {
      throw new ForbiddenError(
        'Este registro tiene un número asignado por la plataforma. Solo un administrador puede eliminarlo; se recomienda marcarlo como anulado en vez de borrarlo.',
      );
    }
    if (rec.numberAssignedAt && !reason) {
      throw new ValidationError('Indica el motivo para eliminar un registro con número asignado');
    }
    const storageKeys = await attachmentsService.deleteForEntity(tx, 'record', [String(id)]);
    await tx.delete(records).where(eq(records.id, id));
    await audit.log(tx, {
      actor,
      action: 'DELETE',
      entityType: 'RECORD',
      entityId: id,
      layerId: rec.layerId,
      metadata: { roleId: rec.roleId, attributes: rec.attributes, lat: rec.lat, lon: rec.lon, reason: reason ?? null, hadNumber: !!rec.numberAssignedAt },
    });
    invalidateFilterOptions(rec.layerId);
    return storageKeys;
  });
  await attachmentsService.purgeStorageKeys(keys);
}

/** Ids de registros de una capa (para operaciones masivas internas). */
export async function listRecordIds(db: DbOrTx, layerId: number): Promise<number[]> {
  const rows = await db.select({ id: records.id }).from(records).where(eq(records.layerId, layerId)).orderBy(desc(records.id));
  return rows.map((r) => r.id);
}

