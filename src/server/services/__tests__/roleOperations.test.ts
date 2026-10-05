/**
 * Operaciones sobre roles (§8.9 / §7.11), contra BD real.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLogs, roleOperationRoles } from '@/db/schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/server/errors';
import * as recordsService from '../records';
import * as ops from '../roleOperations';
import * as rolesService from '../roles';
import { admin, createLayer, createRole, db, editor, getRecordRow, getRoleRow, IN_COMUNA, IN_COMUNA_2, insertRecord, setupDbSuite } from './helpers';

setupDbSuite();

const A = '00100-00001';
const B1 = '00100-00010';
const B2 = '00100-00011';
const C = '00100-00020';

describe('subdivisión', () => {
  it('deja el origen no vigente sin tocar sus registros; crea los resultantes; getRole informa resultRoleIds', async () => {
    const layer = await createLayer();
    await createRole(A, IN_COMUNA);
    const rec = await insertRecord({ layerId: layer.id, roleId: A, ...IN_COMUNA, coordsSource: 'role', attributes: { n_permiso: 1 } });

    const op = await ops.createOperation(db, editor, {
      type: 'subdivision',
      effectiveDate: '2024-03-15',
      reference: 'Res. 45/2024',
      recordId: rec.id,
      originRoleIds: ['100-1'],
      resultRoleIds: ['100-10', '00100-00011'],
      resultCoords: 'none',
    });
    expect(op.type).toBe('subdivision');
    expect(op.originRoleIds).toEqual([A]);
    expect(op.resultRoleIds).toEqual([B1, B2]);
    expect(op.record?.id).toBe(rec.id);
    expect(op.record?.layerName).toBe(layer.name);

    // registros intactos
    const after = await getRecordRow(rec.id);
    expect(after?.roleId).toBe(A);
    expect(after?.lat).toBe(IN_COMUNA.lat);
    expect(after?.coordsSource).toBe('role');

    // vigencia
    const roleA = await rolesService.getRole(db, A);
    expect(roleA.vigente).toBe(false);
    expect(roleA.supersededAt).toBe('2024-03-15');
    expect(roleA.resultRoleIds).toEqual([B1, B2]);
    // resultantes creados, vigentes y sin coordenadas (resultCoords 'none')
    const b1 = await rolesService.getRole(db, B1);
    expect(b1.vigente).toBe(true);
    expect(b1.lat).toBeNull();

    // el detalle del registro avisa de la operación
    const detail = await recordsService.getRecord(db, rec.id);
    expect(detail.role?.vigente).toBe(false);
    expect(detail.roleLastOperation?.id).toBe(op.id);
    expect(detail.backsOperation).toEqual({ id: op.id, type: 'subdivision', originRoleIds: [A] });

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'ROLE_OPERATION'));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe('CREATE');
  });

  it("con resultCoords 'inherit' los resultantes sin coordenadas toman las del origen", async () => {
    await createRole(A, IN_COMUNA);
    await createRole(B2, IN_COMUNA_2); // ya ubicado: no se toca
    await ops.createOperation(db, editor, {
      type: 'subdivision',
      effectiveDate: '2024-03-15',
      originRoleIds: [A],
      resultRoleIds: [B1, B2],
      resultCoords: 'inherit',
    });
    expect((await getRoleRow(B1))?.lat).toBe(IN_COMUNA.lat);
    expect((await getRoleRow(B2))?.lat).toBe(IN_COMUNA_2.lat);
  });

  it('getRoleRecords de un resultante con includeLineage incluye los registros del original con su roleId', async () => {
    const layer = await createLayer();
    await createRole(A, IN_COMUNA);
    const recA = await insertRecord({ layerId: layer.id, roleId: A, ...IN_COMUNA, coordsSource: 'role', attributes: { n_permiso: 1 } });
    await ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-03-15', originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'none' });
    const recB1 = await insertRecord({ layerId: layer.id, roleId: B1, attributes: { n_permiso: 2 } });

    const without = await rolesService.getRoleRecords(db, B1);
    expect(without.total).toBe(1);
    expect(without.groups[0]?.layers[0]?.records.map((r) => r.id)).toEqual([recB1.id]);
    expect(without.history.ancestors).toEqual([A]);
    expect(without.history.operations).toHaveLength(1);

    const withLineage = await rolesService.getRoleRecords(db, B1, { includeLineage: true });
    expect(withLineage.total).toBe(2);
    const items = withLineage.groups[0]!.layers[0]!.records;
    expect(items.find((r) => r.id === recA.id)?.roleId).toBe(A);
    expect(items.find((r) => r.id === recB1.id)?.roleId).toBe(B1);
  });

  it('un origen no vigente no puede ser origen otra vez → Conflict con mensaje claro', async () => {
    await createRole(A, IN_COMUNA);
    await ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-03-15', originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'none' });
    const err = await ops
      .createOperation(db, editor, { type: 'rectificacion', effectiveDate: '2024-04-01', originRoleIds: [A], resultRoleIds: [C], resultCoords: 'none' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toContain(A);
    expect((err as ConflictError).message).toContain('15-03-2024');
    expect((err as ConflictError).message).toContain(B1);
    // tampoco una modificación (anotación) sobre un rol que ya no existe
    await expect(
      ops.createOperation(db, editor, { type: 'modificacion', effectiveDate: '2024-04-01', originRoleIds: [A], resultRoleIds: [], resultCoords: 'none' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('eliminar la operación devuelve la vigencia; los resultantes quedan', async () => {
    const layer = await createLayer();
    await createRole(A, IN_COMUNA);
    const op = await ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-03-15', originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'inherit' });
    const recB1 = await insertRecord({ layerId: layer.id, roleId: B1 });

    await expect(ops.deleteOperation(db, editor, op.id, 'Registrada por error')).rejects.toBeInstanceOf(ForbiddenError);
    await ops.deleteOperation(db, admin, op.id, 'Registrada por error');

    expect((await rolesService.getRole(db, A)).vigente).toBe(true);
    expect((await getRoleRow(B1))?.id).toBe(B1);
    expect((await getRecordRow(recB1.id))?.roleId).toBe(B1);
    expect(await db.select().from(roleOperationRoles)).toHaveLength(0);
    const log = (await db.select().from(auditLogs).where(eq(auditLogs.action, 'DELETE')))[0];
    expect(log?.entityType).toBe('ROLE_OPERATION');
    expect(log?.metadata).toMatchObject({ reason: 'Registrada por error', originRoleIds: [A] });

    await expect(ops.deleteOperation(db, admin, op.id, 'otra vez')).rejects.toBeInstanceOf(NotFoundError);
    // ahora A puede volver a ser origen
    await expect(
      ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-05-01', originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'none' }),
    ).resolves.toMatchObject({ type: 'subdivision' });
  });

  it('superseded_at es la fecha más antigua entre operaciones donde el rol es origen', async () => {
    await createRole(A, IN_COMUNA);
    const first = await ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-03-15', originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'none' });
    // tras borrar y volver a registrar con otra fecha, la vigencia sigue a la operación que exista
    await ops.deleteOperation(db, admin, first.id, 'fecha equivocada');
    await ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-02-01', originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'none' });
    expect((await getRoleRow(A))?.supersededAt).toBe('2024-02-01');
  });
});

describe('fusión, rectificación y modificación', () => {
  it('fusión con resultCoords inherit promedia las coordenadas de los orígenes', async () => {
    await createRole(A, { lat: -33.56, lon: -70.66 });
    await createRole(B1, { lat: -33.58, lon: -70.68 });
    await createRole(B2); // sin coordenadas: no entra en el promedio
    const op = await ops.createOperation(db, editor, {
      type: 'fusion',
      effectiveDate: '2024-06-01',
      originRoleIds: [A, B1, B2],
      resultRoleIds: [C],
      resultCoords: 'inherit',
    });
    expect(op.originRoleIds).toEqual([A, B1, B2]);
    const c = await getRoleRow(C);
    expect(c?.lat).toBeCloseTo(-33.57, 6);
    expect(c?.lon).toBeCloseTo(-70.67, 6);
    for (const id of [A, B1, B2]) expect((await getRoleRow(id))?.supersededAt).toBe('2024-06-01');
  });

  it('rectificación deja el anterior no vigente y el corregido vigente', async () => {
    await createRole(A, IN_COMUNA);
    await ops.createOperation(db, editor, { type: 'rectificacion', effectiveDate: '2024-01-10', originRoleIds: [A], resultRoleIds: [C], resultCoords: 'inherit' });
    expect((await rolesService.getRole(db, A)).vigente).toBe(false);
    const c = await rolesService.getRole(db, C);
    expect(c.vigente).toBe(true);
    expect(c.lat).toBe(IN_COMUNA.lat);
  });

  it('modificación no cambia la vigencia y queda en el historial', async () => {
    await createRole(A, IN_COMUNA);
    const op = await ops.createOperation(db, editor, {
      type: 'modificacion',
      effectiveDate: '2024-01-10',
      comment: 'Cambio de destino',
      originRoleIds: [A],
      resultRoleIds: [],
      resultCoords: 'none',
    });
    expect(op.resultRoleIds).toEqual([]);
    expect((await rolesService.getRole(db, A)).vigente).toBe(true);
    const history = await rolesService.getRoleHistory(db, A);
    expect(history.operations.map((o) => o.id)).toEqual([op.id]);
    expect(history.ancestors).toEqual([]);
    expect(history.descendants).toEqual([]);
  });

  it('getRoleHistory ancestors/descendants en una cadena de 3', async () => {
    await createRole(A, IN_COMUNA);
    await ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-01-01', originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'none' });
    await ops.createOperation(db, editor, { type: 'rectificacion', effectiveDate: '2024-02-01', originRoleIds: [B1], resultRoleIds: [C], resultCoords: 'none' });

    const hA = await rolesService.getRoleHistory(db, A);
    expect(hA.ancestors).toEqual([]);
    expect(hA.descendants).toEqual([B1, B2, C]);

    const hC = await rolesService.getRoleHistory(db, C);
    expect(hC.ancestors).toEqual([A, B1]);
    expect(hC.descendants).toEqual([]);
    expect(hC.operations).toHaveLength(1);

    const hB1 = await rolesService.getRoleHistory(db, B1);
    expect(hB1.ancestors).toEqual([A]);
    expect(hB1.descendants).toEqual([C]);
    expect(hB1.operations.map((o) => o.type)).toEqual(['subdivision', 'rectificacion']);

    // la búsqueda marca los no vigentes con sus resultantes
    const found = await rolesService.searchRoles(db, '100-1', 10);
    const a = found.find((r) => r.id === A);
    expect(a?.vigente).toBe(false);
    expect(a?.resultRoleIds).toEqual([B1, B2]);
  });
});

describe('validaciones', () => {
  it('normaliza los roles y rechaza formatos inválidos', async () => {
    await createRole(A);
    await expect(
      ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-01-01', originRoleIds: [A], resultRoleIds: ['abc', B2], resultCoords: 'none' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('un rol no puede ser origen y resultante a la vez', async () => {
    await createRole(A);
    await expect(
      ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-01-01', originRoleIds: [A], resultRoleIds: [A, B1], resultCoords: 'none' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('revalida la cardinalidad tras quitar repetidos', async () => {
    await createRole(A);
    await expect(
      ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-01-01', originRoleIds: [A], resultRoleIds: ['100-10', '00100-00010'], resultCoords: 'none' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ops.createOperation(db, editor, { type: 'fusion', effectiveDate: '2024-01-01', originRoleIds: [A, '100-1'], resultRoleIds: [C], resultCoords: 'none' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('un origen que no está registrado → NotFound con indicación', async () => {
    await expect(
      ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-01-01', originRoleIds: ['99999-99999'], resultRoleIds: [B1, B2], resultCoords: 'none' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await getRoleRow(B1)).toBeNull(); // la transacción no creó nada
  });

  it('un registro de respaldo inexistente → NotFound', async () => {
    await createRole(A);
    await expect(
      ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-01-01', recordId: 123456, originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'none' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listOperations', () => {
  it('pagina y filtra por tipo, fechas y rol', async () => {
    await createRole(A, IN_COMUNA);
    await createRole('00200-00001', IN_COMUNA);
    await createRole('00200-00002', IN_COMUNA);
    const s = await ops.createOperation(db, editor, { type: 'subdivision', effectiveDate: '2024-01-01', originRoleIds: [A], resultRoleIds: [B1, B2], resultCoords: 'none' });
    const f = await ops.createOperation(db, editor, { type: 'fusion', effectiveDate: '2024-03-01', originRoleIds: ['00200-00001', '00200-00002'], resultRoleIds: [C], resultCoords: 'none' });
    const m = await ops.createOperation(db, editor, { type: 'modificacion', effectiveDate: '2024-02-01', originRoleIds: [B1], resultRoleIds: [], resultCoords: 'none' });

    const all = await ops.listOperations(db, { page: 1, pageSize: 50 });
    expect(all.total).toBe(3);
    expect(all.data.map((o) => o.id)).toEqual([f.id, m.id, s.id]); // más reciente primero

    const page2 = await ops.listOperations(db, { page: 2, pageSize: 2 });
    expect(page2.data.map((o) => o.id)).toEqual([s.id]);

    expect((await ops.listOperations(db, { page: 1, pageSize: 50, type: 'fusion' })).data.map((o) => o.id)).toEqual([f.id]);
    expect((await ops.listOperations(db, { page: 1, pageSize: 50, from: '2024-01-15', to: '2024-02-15' })).data.map((o) => o.id)).toEqual([m.id]);
    expect((await ops.listOperations(db, { page: 1, pageSize: 50, roleId: '100-10' })).data.map((o) => o.id)).toEqual([m.id, s.id]);
    await expect(ops.listOperations(db, { page: 1, pageSize: 50, roleId: 'zzz' })).rejects.toBeInstanceOf(ValidationError);
  });
});
