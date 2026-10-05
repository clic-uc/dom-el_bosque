/**
 * Reglas de coordenadas de roles y registros (§8.3) probadas a través de los servicios reales, contra BD.
 */
import { describe, expect, it } from 'vitest';
import { ConflictError } from '@/server/errors';
import * as recordsService from '../records';
import * as roleOperationsService from '../roleOperations';
import * as rolesService from '../roles';
import {
  admin,
  createLayer,
  createRole,
  field,
  getRecordRow,
  getRoleRow,
  IN_COMUNA,
  IN_COMUNA_2,
  insertRecord,
  setupDbSuite,
  db,
} from './helpers';

setupDbSuite();

const ROLE = '00050-00001';
const ROLE_B = '00050-00002';

describe('ubicar un registro al crearlo (§8.3, orden 1-4)', () => {
  it("coordenadas propias → 'own' y el rol sin coordenadas las adopta", async () => {
    const layer = await createLayer();
    await createRole(ROLE);
    const rec = await recordsService.createRecord(db, admin, {
      layerId: layer.id,
      roleId: ROLE,
      lat: IN_COMUNA.lat,
      lon: IN_COMUNA.lon,
      attributes: {},
    });
    expect(rec.coordsSource).toBe('own');
    expect(rec.lat).toBe(IN_COMUNA.lat);
    const role = await getRoleRow(ROLE);
    expect(role?.lat).toBe(IN_COMUNA.lat);
    expect(role?.lon).toBe(IN_COMUNA.lon);
  });

  it('un rol que ya tiene coordenadas NO las cambia por las propias del registro', async () => {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    const rec = await recordsService.createRecord(db, admin, {
      layerId: layer.id,
      roleId: ROLE,
      lat: IN_COMUNA_2.lat,
      lon: IN_COMUNA_2.lon,
      attributes: {},
    });
    expect(rec.coordsSource).toBe('own');
    const role = await getRoleRow(ROLE);
    expect(role?.lat).toBe(IN_COMUNA.lat);
  });

  it("rol con coordenadas y sin propias → 'role'", async () => {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    const rec = await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: '50-1', attributes: {} });
    expect(rec.roleId).toBe(ROLE);
    expect(rec.coordsSource).toBe('role');
    expect(rec.lat).toBe(IN_COMUNA.lat);
    expect(rec.lon).toBe(IN_COMUNA.lon);
  });

  it('dirección exacta del padrón sin rol, en capa con rol → asigna el rol y queda en role', async () => {
    const layer = await createLayer({ addressFieldKey: 'direccion' });
    await createRole(ROLE, { ...IN_COMUNA, address: 'RIQUELME 111 V ITALIA' });
    const rec = await recordsService.createRecord(db, admin, {
      layerId: layer.id,
      attributes: { direccion: 'Riquelme 111' },
    });
    expect(rec.roleId).toBe(ROLE);
    expect(rec.coordsSource).toBe('role');
    expect(rec.lat).toBe(IN_COMUNA.lat);
  });

  it('las coordenadas geocodificadas nunca se copian al rol', async () => {
    const layer = await createLayer({ addressFieldKey: 'direccion' });
    await createRole(ROLE, { ...IN_COMUNA, address: 'RIQUELME 111' });
    await createRole(ROLE_B); // sin coordenadas
    // dirección aproximada del padrón (número vecino) → geocoded, con el rol B que no tiene coordenadas
    const rec = await recordsService.createRecord(db, admin, {
      layerId: layer.id,
      roleId: ROLE_B,
      attributes: { direccion: 'Riquelme 113' },
    });
    expect(rec.coordsSource).toBe('geocoded');
    expect(rec.geocode?.provider).toBe('padron');
    const roleB = await getRoleRow(ROLE_B);
    expect(roleB?.lat).toBeNull();
  });

  it('sin propias, sin rol ubicable y sin dirección → sin coordenadas', async () => {
    const layer = await createLayer();
    await createRole(ROLE);
    const rec = await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: {} });
    expect(rec.lat).toBeNull();
    expect(rec.lon).toBeNull();
    expect(rec.coordsSource).toBeNull();
  });

  it('en una capa sin rol el registro ignora el rol y solo puede tener own o nada', async () => {
    const layer = await createLayer({ hasRole: false });
    const a = await recordsService.createRecord(db, admin, { layerId: layer.id, roleId: ROLE, attributes: {} });
    expect(a.roleId).toBeNull();
    expect(a.coordsSource).toBeNull();
    const b = await recordsService.createRecord(db, admin, { layerId: layer.id, lat: IN_COMUNA.lat, lon: IN_COMUNA.lon, attributes: {} });
    expect(b.coordsSource).toBe('own');
  });
});

describe('editar un registro (§8.3)', () => {
  it("cambiar el roleId con coordenadas 'role' toma las del nuevo rol", async () => {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    await createRole(ROLE_B, IN_COMUNA_2);
    const rec = await insertRecord({ layerId: layer.id, roleId: ROLE, ...IN_COMUNA, coordsSource: 'role' });
    const after = await recordsService.updateRecord(db, admin, rec.id, { roleId: ROLE_B });
    expect(after.roleId).toBe(ROLE_B);
    expect(after.coordsSource).toBe('role');
    expect(after.lat).toBe(IN_COMUNA_2.lat);
  });

  it("cambiar el roleId con coordenadas 'own' no las cambia", async () => {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    await createRole(ROLE_B, IN_COMUNA_2);
    const rec = await insertRecord({ layerId: layer.id, roleId: ROLE, lat: -33.57, lon: -70.67, coordsSource: 'own' });
    const after = await recordsService.updateRecord(db, admin, rec.id, { roleId: ROLE_B });
    expect(after.roleId).toBe(ROLE_B);
    expect(after.coordsSource).toBe('own');
    expect(after.lat).toBe(-33.57);
  });

  it("cambiar el roleId con coordenadas 'geocoded' a un rol con coordenadas las reemplaza", async () => {
    const layer = await createLayer();
    await createRole(ROLE_B, IN_COMUNA_2);
    const rec = await insertRecord({
      layerId: layer.id,
      roleId: null,
      ...IN_COMUNA,
      coordsSource: 'geocoded',
      geocode: { provider: 'padron', confidence: 'approx', query: 'x' },
    });
    const after = await recordsService.updateRecord(db, admin, rec.id, { roleId: ROLE_B });
    expect(after.coordsSource).toBe('role');
    expect(after.geocode).toBeNull();
    expect(after.lat).toBe(IN_COMUNA_2.lat);
  });

  it("quitar el rol a un registro 'role' conserva las coordenadas como 'own'", async () => {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    const rec = await insertRecord({ layerId: layer.id, roleId: ROLE, ...IN_COMUNA, coordsSource: 'role' });
    const after = await recordsService.updateRecord(db, admin, rec.id, { roleId: null });
    expect(after.roleId).toBeNull();
    expect(after.coordsSource).toBe('own');
    expect(after.lat).toBe(IN_COMUNA.lat);
  });

  it("editar lat/lon → 'own' (y el rol sin coordenadas las adopta)", async () => {
    const layer = await createLayer();
    await createRole(ROLE);
    const rec = await insertRecord({ layerId: layer.id, roleId: ROLE });
    const after = await recordsService.updateRecord(db, admin, rec.id, { lat: IN_COMUNA.lat, lon: IN_COMUNA.lon });
    expect(after.coordsSource).toBe('own');
    expect((await getRoleRow(ROLE))?.lat).toBe(IN_COMUNA.lat);
  });

  it('quitar lat/lon deja el registro sin coordenadas', async () => {
    const layer = await createLayer();
    const rec = await insertRecord({ layerId: layer.id, ...IN_COMUNA, coordsSource: 'own' });
    const after = await recordsService.updateRecord(db, admin, rec.id, { lat: null, lon: null });
    expect(after.lat).toBeNull();
    expect(after.coordsSource).toBeNull();
  });
});

describe('updateCoordinates (§7.3 / §8.3)', () => {
  async function scenario() {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    const moved = await insertRecord({ layerId: layer.id, roleId: ROLE, ...IN_COMUNA, coordsSource: 'role' });
    const fromRole = await insertRecord({ layerId: layer.id, roleId: ROLE, ...IN_COMUNA, coordsSource: 'role' });
    const geocoded = await insertRecord({
      layerId: layer.id,
      roleId: ROLE,
      lat: -33.58,
      lon: -70.68,
      coordsSource: 'geocoded',
      geocode: { provider: 'padron', confidence: 'approx', query: 'x' },
    });
    const noCoords = await insertRecord({ layerId: layer.id, roleId: ROLE });
    const own = await insertRecord({ layerId: layer.id, roleId: ROLE, lat: -33.59, lon: -70.69, coordsSource: 'own' });
    return { layer, moved, fromRole, geocoded, noCoords, own };
  }

  it("scope 'record' solo mueve ese registro y lo deja en 'own'", async () => {
    const s = await scenario();
    const r = await recordsService.updateCoordinates(db, admin, s.moved.id, { lat: IN_COMUNA_2.lat, lon: IN_COMUNA_2.lon, scope: 'record' });
    expect(r.updated).toBe(1);
    const moved = await getRecordRow(s.moved.id);
    expect(moved?.coordsSource).toBe('own');
    expect(moved?.lat).toBe(IN_COMUNA_2.lat);
    expect((await getRecordRow(s.fromRole.id))?.lat).toBe(IN_COMUNA.lat);
    expect((await getRoleRow(ROLE))?.lat).toBe(IN_COMUNA.lat);
  });

  it("scope 'role' actualiza el rol y propaga a role/geocoded/sin coordenadas, no a own", async () => {
    const s = await scenario();
    const r = await recordsService.updateCoordinates(db, admin, s.moved.id, { lat: IN_COMUNA_2.lat, lon: IN_COMUNA_2.lon, scope: 'role' });
    // movido + fromRole + geocoded + sin coordenadas = 4
    expect(r.updated).toBe(4);
    expect((await getRoleRow(ROLE))?.lat).toBe(IN_COMUNA_2.lat);
    for (const id of [s.moved.id, s.fromRole.id, s.geocoded.id, s.noCoords.id]) {
      const row = await getRecordRow(id);
      expect(row?.coordsSource).toBe('role');
      expect(row?.lat).toBe(IN_COMUNA_2.lat);
      expect(row?.geocode).toBeNull();
    }
    const own = await getRecordRow(s.own.id);
    expect(own?.coordsSource).toBe('own');
    expect(own?.lat).toBe(-33.59);
  });

  it("scope 'role' sin rol → error de validación", async () => {
    const layer = await createLayer();
    const rec = await insertRecord({ layerId: layer.id, ...IN_COMUNA, coordsSource: 'own' });
    await expect(
      recordsService.updateCoordinates(db, admin, rec.id, { lat: IN_COMUNA_2.lat, lon: IN_COMUNA_2.lon, scope: 'role' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it("useRole copia las coordenadas del rol y vuelve a 'role'", async () => {
    const s = await scenario();
    const r = await recordsService.updateCoordinates(db, admin, s.own.id, { useRole: true });
    expect(r.updated).toBe(1);
    const own = await getRecordRow(s.own.id);
    expect(own?.coordsSource).toBe('role');
    expect(own?.lat).toBe(IN_COMUNA.lat);
  });
});

describe('cambios en el rol (§7.4 / §8.3)', () => {
  it("PATCH del rol propaga a los registros 'role', 'geocoded' y sin coordenadas; no a 'own'", async () => {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    const a = await insertRecord({ layerId: layer.id, roleId: ROLE, ...IN_COMUNA, coordsSource: 'role' });
    const b = await insertRecord({ layerId: layer.id, roleId: ROLE, lat: -33.58, lon: -70.68, coordsSource: 'geocoded', geocode: { provider: 'padron', confidence: 'approx', query: 'q' } });
    const c = await insertRecord({ layerId: layer.id, roleId: ROLE });
    const d = await insertRecord({ layerId: layer.id, roleId: ROLE, lat: -33.59, lon: -70.69, coordsSource: 'own' });
    await rolesService.updateRole(db, admin, ROLE, { lat: IN_COMUNA_2.lat, lon: IN_COMUNA_2.lon });
    for (const id of [a.id, b.id, c.id]) {
      const row = await getRecordRow(id);
      expect(row?.lat).toBe(IN_COMUNA_2.lat);
      expect(row?.coordsSource).toBe('role');
    }
    expect((await getRecordRow(d.id))?.lat).toBe(-33.59);
  });

  it("reimportar el padrón mueve los registros 'role' y 'geocoded' y NO los 'own'", async () => {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    const fromRole = await insertRecord({ layerId: layer.id, roleId: ROLE, ...IN_COMUNA, coordsSource: 'role' });
    const geocoded = await insertRecord({
      layerId: layer.id,
      roleId: ROLE,
      lat: -33.58,
      lon: -70.68,
      coordsSource: 'geocoded',
      geocode: { provider: 'nominatim', confidence: 'street', query: 'q' },
    });
    const own = await insertRecord({ layerId: layer.id, roleId: ROLE, lat: -33.59, lon: -70.69, coordsSource: 'own' });
    const noCoords = await insertRecord({ layerId: layer.id, roleId: ROLE });

    const csv = ['roleId;DIRECCION;COMPLEMENTO;lat;lon', `50-1;RIQUELME 111;V ITALIA;${IN_COMUNA_2.lat};${IN_COMUNA_2.lon}`].join('\r\n');
    const summary = await rolesService.importRoleCoordinates(db, admin, Buffer.from(csv, 'utf8'), { fileName: 'padron.csv' });
    expect(summary.upsertedRoles).toBe(1);
    expect(summary.invalidRows).toEqual([]);
    expect(summary.updatedRecords).toBe(3);

    const role = await getRoleRow(ROLE);
    expect(role?.lat).toBe(IN_COMUNA_2.lat);
    expect(role?.address).toBe('RIQUELME 111 V ITALIA');
    expect(role?.streetNorm).toBe('riquelme');
    expect(role?.houseNumber).toBe(111);

    for (const id of [fromRole.id, geocoded.id, noCoords.id]) {
      const row = await getRecordRow(id);
      expect(row?.lat).toBe(IN_COMUNA_2.lat);
      expect(row?.coordsSource).toBe('role');
      expect(row?.geocode).toBeNull();
    }
    const ownRow = await getRecordRow(own.id);
    expect(ownRow?.lat).toBe(-33.59);
    expect(ownRow?.coordsSource).toBe('own');
  });

  it('el padrón reporta los roles vigentes que no vienen en el archivo y no cambia su vigencia', async () => {
    await createRole(ROLE, IN_COMUNA);
    await createRole(ROLE_B, IN_COMUNA);
    await createRole('00050-00003', { ...IN_COMUNA, supersededAt: '2020-01-01' });
    const csv = ['roleId;lat;lon', `${ROLE};${IN_COMUNA.lat};${IN_COMUNA.lon}`, 'abc;1;2'].join('\n');
    const summary = await rolesService.importRoleCoordinates(db, admin, Buffer.from(csv));
    expect(summary.missingFromPadron).toEqual([ROLE_B]);
    expect(summary.invalidRows).toHaveLength(1);
    expect((await getRoleRow('00050-00003'))?.supersededAt).toBe('2020-01-01');
  });

  it("deleteRole deja los registros sin rol, con sus coordenadas como 'own'", async () => {
    const layer = await createLayer();
    await createRole(ROLE, IN_COMUNA);
    const a = await insertRecord({ layerId: layer.id, roleId: ROLE, ...IN_COMUNA, coordsSource: 'role' });
    const b = await insertRecord({ layerId: layer.id, roleId: ROLE });
    await rolesService.deleteRole(db, admin, ROLE);
    expect(await getRoleRow(ROLE)).toBeNull();
    const ra = await getRecordRow(a.id);
    expect(ra?.roleId).toBeNull();
    expect(ra?.coordsSource).toBe('own');
    expect(ra?.lat).toBe(IN_COMUNA.lat);
    const rb = await getRecordRow(b.id);
    expect(rb?.roleId).toBeNull();
    expect(rb?.coordsSource).toBeNull();
  });

  it('deleteRole falla con Conflict si el rol participa en operaciones', async () => {
    await createRole(ROLE, IN_COMUNA);
    await roleOperationsService.createOperation(db, admin, {
      type: 'subdivision',
      effectiveDate: '2024-03-01',
      originRoleIds: [ROLE],
      resultRoleIds: ['50-10', '50-11'],
      resultCoords: 'none',
    });
    await expect(rolesService.deleteRole(db, admin, ROLE)).rejects.toBeInstanceOf(ConflictError);
    await expect(rolesService.deleteRole(db, admin, '50-10')).rejects.toBeInstanceOf(ConflictError);
  });

  it('un rol con formato inválido en la URL es un error de validación, no un 500', async () => {
    await expect(rolesService.getRole(db, 'abc')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(rolesService.getRole(db, '99999-99999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('capa con addressFieldKey y helpers de campo', () => {
  it('field() produce campos válidos', () => {
    expect(field('a', 'A').type).toBe('string');
  });
});
