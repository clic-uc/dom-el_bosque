/**
 * Duplicados e identidad de un registro (§8.4), contra BD real.
 */
import { describe, expect, it } from 'vitest';
import { ConflictError } from '@/server/errors';
import type { DuplicateConflictDetails } from '@/shared/types';
import { previewDuplicates } from '../duplicates';
import * as recordsService from '../records';
import { admin, createLayer, createRole, db, field, insertRecord, setupDbSuite } from './helpers';

setupDbSuite();

const ROLE = '00050-00001';
const ROLE_B = '00050-00002';

const permisoFields = [field('n_permiso', 'N° Permiso', 'number'), field('nombre', 'Nombre'), field('obs', 'Observaciones')];

describe('identidad = rol + campos únicos (capa con rol)', () => {
  it('mismo rol y distinto N° Permiso NO es duplicado', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['n_permiso'] });
    await createRole(ROLE);
    await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1 } });
    const second = await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 2 } });
    expect(second.id).toBeGreaterThan(0);
    expect(second.sameRoleCount).toBe(1);
  });

  it('mismo rol y mismo N° Permiso SÍ es duplicado → Conflict con el registro existente', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['n_permiso'] });
    await createRole(ROLE);
    const first = await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 45 } });
    const err = await recordsService
      .createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 45 } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    const details = (err as ConflictError).details as DuplicateConflictDetails;
    expect(details.kind).toBe('duplicate');
    expect(details.existingRecordId).toBe(first.id);
    expect((err as ConflictError).message).toContain('N° Permiso');
    expect((err as ConflictError).message).toContain(ROLE);
  });

  it('distinto rol y mismo N° Permiso no es duplicado en una capa con rol', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['n_permiso'] });
    await createRole(ROLE);
    await createRole(ROLE_B);
    await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 7 } });
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE_B, attributes: { n_permiso: 7 } }),
    ).resolves.toBeTruthy();
  });

  it('los números se comparan por valor ("0045" y "45,0" son el mismo N° Permiso)', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['n_permiso'] });
    await createRole(ROLE);
    await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: '0045' } });
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 45 } }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: '45,0' } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('los textos se comparan sin acentos, sin espacios de más y sin distinguir mayúsculas', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['nombre'] });
    await createRole(ROLE);
    await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { nombre: 'José   Pérez ' } });
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { nombre: 'jose perez' } }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { nombre: 'JOSÉ PEREZ' } }),
    ).rejects.toBeInstanceOf(ConflictError);
    // un nombre distinto sí pasa
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { nombre: 'José Pereira' } }),
    ).resolves.toBeTruthy();
  });

  it('campos únicos vacíos no se comparan (dos registros sin N° Permiso conviven)', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['n_permiso'] });
    await createRole(ROLE);
    await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { nombre: 'a' } });
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { nombre: 'b', n_permiso: '' } }),
    ).resolves.toBeTruthy();
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: null } }),
    ).resolves.toBeTruthy();
  });

  it('con varios campos únicos, basta que uno difiera', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['n_permiso', 'nombre'] });
    await createRole(ROLE);
    await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1, nombre: 'a' } });
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1, nombre: 'b' } }),
    ).resolves.toBeTruthy();
    await expect(
      recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1, nombre: 'A' } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('en una capa con rol, un registro sin rol tiene identidad incompleta y no se compara', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['n_permiso'] });
    await recordsService.createRecord(db, admin, { layerId: layer.id, attributes: { n_permiso: 9 } });
    await expect(recordsService.createRecord(db, admin, { layerId: layer.id, attributes: { n_permiso: 9 } })).resolves.toBeTruthy();
  });
});

describe('capa sin uniqueKeys', () => {
  it('capa con rol y sin campos únicos: un rol puede tener todos los registros que quiera', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: [] });
    await createRole(ROLE);
    for (let i = 0; i < 3; i++) {
      await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1 } });
    }
    const list = await recordsService.listRecords(db, layer.id, { page: 1, pageSize: 50, sort: 'id', dir: 'asc', filters: {} });
    expect(list.total).toBe(3);
  });

  it('capa sin rol y sin campos únicos: no detecta duplicados', async () => {
    const layer = await createLayer({ hasRole: false, fields: permisoFields, uniqueKeys: [] });
    await recordsService.createRecord(db, admin, { layerId: layer.id, attributes: { n_permiso: 1 } });
    await expect(recordsService.createRecord(db, admin, { layerId: layer.id, attributes: { n_permiso: 1 } })).resolves.toBeTruthy();
  });

  it('capa sin rol con campos únicos: la identidad son solo los campos únicos', async () => {
    const layer = await createLayer({ hasRole: false, fields: permisoFields, uniqueKeys: ['n_permiso'] });
    await recordsService.createRecord(db, admin, { layerId: layer.id, attributes: { n_permiso: 1 } });
    await expect(recordsService.createRecord(db, admin, { layerId: layer.id, attributes: { n_permiso: 1 } })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('edición y previsualización', () => {
  it('updateRecord que produce la identidad de otro registro → Conflict (y editarse a sí mismo no)', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: ['n_permiso'] });
    await createRole(ROLE);
    const a = await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1 } });
    const b = await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 2 } });
    await expect(recordsService.updateRecord(db, admin, b.id, { attributes: { n_permiso: 1 } })).rejects.toBeInstanceOf(ConflictError);
    // guardar el mismo registro con su misma identidad no choca consigo mismo
    await expect(recordsService.updateRecord(db, admin, a.id, { attributes: { nombre: 'x' } })).resolves.toBeTruthy();
    // cambiar el rol al de otro registro con el mismo número también choca
    await createRole(ROLE_B);
    const c = await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE_B, attributes: { n_permiso: 1 } });
    await expect(recordsService.updateRecord(db, admin, c.id, { roleId: ROLE })).rejects.toBeInstanceOf(ConflictError);
  });

  it('previewDuplicates cuenta los grupos que quedarían repetidos con otros campos únicos', async () => {
    const layer = await createLayer({ fields: permisoFields, uniqueKeys: [] });
    await createRole(ROLE);
    await createRole(ROLE_B);
    await insertRecord({ layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1, nombre: 'a' } });
    await insertRecord({ layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1, nombre: 'b' } });
    await insertRecord({ layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 1, nombre: 'c' } });
    await insertRecord({ layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 2 } });
    await insertRecord({ layerId: layer.id, roleId: ROLE_B, attributes: { n_permiso: 1 } });
    await insertRecord({ layerId: layer.id, roleId: ROLE_B, attributes: {} }); // incompleto: no cuenta
    await insertRecord({ layerId: layer.id, roleId: ROLE_B, attributes: {} });

    const byNumber = await previewDuplicates(db, layer, ['n_permiso']);
    expect(byNumber.groups).toBe(1);
    expect(byNumber.records).toBe(3);
    expect(byNumber.sample[0]?.recordIds).toHaveLength(3);
    expect(byNumber.sample[0]?.key).toMatchObject({ 'Rol SII': ROLE, 'N° Permiso': '1' });

    const byBoth = await previewDuplicates(db, layer, ['n_permiso', 'nombre']);
    expect(byBoth.groups).toBe(0);

    const none = await previewDuplicates(db, layer, []);
    expect(none).toEqual({ groups: 0, records: 0, sample: [] });
  });
});
