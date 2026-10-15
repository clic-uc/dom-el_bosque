/**
 * records.service (§7.3), filters (§7.5) y export (§7.6), contra BD real.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors';
import * as attachmentsService from '../attachments';
import * as exportService from '../export';
import * as filtersService from '../filters';
import * as recordsService from '../records';
import {
  admin,
  createLayer,
  createRole,
  db,
  editor,
  field,
  getRecordRow,
  IN_COMUNA,
  IN_COMUNA_2,
  insertRecord,
  insertRecords,
  readStream,
  setupDbSuite,
} from './helpers';

setupDbSuite();

const ROLE = '00050-00001';
const ROLE_B = '00050-00002';

const fields = [
  field('n_permiso', 'N° Permiso', 'number'),
  field('direccion', 'Dirección'),
  field('tipo', 'Tipo'),
  field('m2', 'Superficie m²', 'number'),
  field('fecha', 'Fecha ingreso', 'date'),
  field('aprobado', 'Aprobado', 'boolean'),
];

const baseQuery = { page: 1, pageSize: 50, sort: 'updatedAt', dir: 'desc', filters: {} } as const;

describe('getFeatures (§7.3)', () => {
  it('devuelve solo registros con coordenadas, con properties mínimas (id, roleId, coordsSource, 3 primeros campos)', async () => {
    const layer = await createLayer({ fields, heatmapFieldKey: 'm2' });
    await createRole(ROLE, IN_COMUNA);
    const a = await insertRecord({
      layerId: layer.id,
      roleId: ROLE,
      ...IN_COMUNA,
      coordsSource: 'role',
      attributes: { n_permiso: 1, direccion: 'Riquelme 111', tipo: 'Casa', m2: 80.5, fecha: '2024-01-02', aprobado: true },
    });
    await insertRecord({ layerId: layer.id, roleId: ROLE, attributes: { n_permiso: 2 } }); // sin coordenadas

    const fc = await recordsService.getFeatures(db, layer.id, { filters: {} });
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0]!;
    expect(f.id).toBe(a.id);
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [IN_COMUNA.lon, IN_COMUNA.lat] });
    expect(f.properties).toEqual({ id: a.id, roleId: ROLE, coordsSource: 'role', n_permiso: 1, direccion: 'Riquelme 111', tipo: 'Casa' });
    expect(f.properties).not.toHaveProperty('m2');
    expect(f.properties).not.toHaveProperty('w');
  });

  it('con weight=true agrega w solo si hay heatmapFieldKey y el valor es numérico', async () => {
    const layer = await createLayer({ fields, heatmapFieldKey: 'm2' });
    const withValue = await insertRecord({ layerId: layer.id, ...IN_COMUNA, coordsSource: 'own', attributes: { m2: 120 } });
    await insertRecord({ layerId: layer.id, ...IN_COMUNA_2, coordsSource: 'own', attributes: { m2: 'no numérico' } });
    await insertRecord({ layerId: layer.id, ...IN_COMUNA_2, coordsSource: 'own', attributes: {} });

    const weighted = await recordsService.getFeatures(db, layer.id, { filters: {}, weight: true });
    expect(weighted.features).toHaveLength(1);
    expect(weighted.features[0]!.id).toBe(withValue.id);
    expect(weighted.features[0]!.properties.w).toBe(120);

    const plain = await recordsService.getFeatures(db, layer.id, { filters: {} });
    expect(plain.features).toHaveLength(3);
    expect(plain.features.every((x) => !('w' in x.properties))).toBe(true);

    const noHeatmap = await createLayer({ fields });
    await insertRecord({ layerId: noHeatmap.id, ...IN_COMUNA, coordsSource: 'own', attributes: { m2: 5 } });
    const fc = await recordsService.getFeatures(db, noHeatmap.id, { filters: {}, weight: true });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties).not.toHaveProperty('w');
  });

  it('acepta los mismos filtros que la tabla', async () => {
    const layer = await createLayer({ fields });
    await insertRecord({ layerId: layer.id, ...IN_COMUNA, coordsSource: 'own', attributes: { tipo: 'Casa' } });
    await insertRecord({ layerId: layer.id, ...IN_COMUNA, coordsSource: 'own', attributes: { tipo: 'Local' } });
    const fc = await recordsService.getFeatures(db, layer.id, { filters: { tipo: ['Casa'] } });
    expect(fc.features).toHaveLength(1);
    await expect(recordsService.getFeatures(db, 99999, { filters: {} })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listRecords (§7.3)', () => {
  async function seed() {
    const layer = await createLayer({ fields: [...fields.filter((f) => f.key !== 'n_permiso'), field('n_permiso', 'N° Permiso', 'autonumber')] });
    await createRole(ROLE, IN_COMUNA);
    await createRole(ROLE_B);
    const rows = [
      { roleId: ROLE, lat: IN_COMUNA.lat, lon: IN_COMUNA.lon, coordsSource: 'role' as const, attributes: { n_permiso: 10, tipo: 'Casa', m2: 100, direccion: 'Riquelme 111' }, comments: 'Permiso antiguo' },
      { roleId: ROLE, lat: IN_COMUNA.lat, lon: IN_COMUNA.lon, coordsSource: 'own' as const, attributes: { n_permiso: 2, tipo: 'Casa', m2: 20 } },
      { roleId: ROLE_B, attributes: { n_permiso: 9, tipo: 'Local', m2: 9 } },
      { roleId: null, attributes: { tipo: 'Galpón', m2: 1000, direccion: 'Los Morros 5555' } },
      { roleId: null, attributes: { tipo: '', m2: 'texto' } },
    ];
    const ids: number[] = [];
    for (const r of rows) ids.push((await insertRecord({ layerId: layer.id, ...r })).id);
    return { layer, ids };
  }

  it('pagina siempre y devuelve total', async () => {
    const { layer } = await seed();
    const p1 = await recordsService.listRecords(db, layer.id, { ...baseQuery, pageSize: 2, sort: 'id', dir: 'asc' });
    expect(p1.total).toBe(5);
    expect(p1.data).toHaveLength(2);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(2);
    const p3 = await recordsService.listRecords(db, layer.id, { ...baseQuery, page: 3, pageSize: 2, sort: 'id', dir: 'asc' });
    expect(p3.data).toHaveLength(1);
    expect(p3.data[0]).not.toHaveProperty('geom');
  });

  it('ordena por columnas y por attr:<key> numérico (nulos y textos al final)', async () => {
    const { layer, ids } = await seed();
    const byM2 = await recordsService.listRecords(db, layer.id, { ...baseQuery, sort: 'attr:m2', dir: 'asc' });
    expect(byM2.data.map((r) => r.id)).toEqual([ids[2], ids[1], ids[0], ids[3], ids[4]]);
    const byM2Desc = await recordsService.listRecords(db, layer.id, { ...baseQuery, sort: 'attr:m2', dir: 'desc' });
    expect(byM2Desc.data.map((r) => r.id).slice(0, 2)).toEqual([ids[3], ids[0]]);
    const byNumber = await recordsService.listRecords(db, layer.id, { ...baseQuery, sort: 'attr:n_permiso', dir: 'asc' });
    expect(byNumber.data.map((r) => r.attributes.n_permiso).slice(0, 3)).toEqual([2, 9, 10]);
    const byRole = await recordsService.listRecords(db, layer.id, { ...baseQuery, sort: 'roleId', dir: 'asc' });
    expect(byRole.data.map((r) => r.roleId).slice(0, 3)).toEqual([ROLE, ROLE, ROLE_B]);
    const byText = await recordsService.listRecords(db, layer.id, { ...baseQuery, sort: 'attr:tipo', dir: 'asc' });
    expect(byText.data[0]?.attributes.tipo).toBe('');
  });

  it('filtra: array → IN, texto → prefijo ILIKE, "" → vacío, hasCoordinates, coordsSource, hasNumber', async () => {
    const { layer, ids } = await seed();
    const list = (q: Partial<Parameters<typeof recordsService.listRecords>[2]>) =>
      recordsService.listRecords(db, layer.id, { ...baseQuery, sort: 'id', dir: 'asc', ...q }).then((r) => r.data.map((x) => x.id));

    expect(await list({ filters: { tipo: ['Casa', 'Local'] } })).toEqual([ids[0], ids[1], ids[2]]);
    expect(await list({ filters: { tipo: 'ca' } })).toEqual([ids[0], ids[1]]);
    expect(await list({ filters: { tipo: 'asa' } })).toEqual([]); // prefijo, no contiene
    expect(await list({ filters: { tipo: [''] } })).toEqual([ids[4]]);
    expect(await list({ filters: { tipo: ['', 'Local'] } })).toEqual([ids[2], ids[4]]);
    expect(await list({ filters: { direccion: ['Riquelme 111'], tipo: 'Casa' } })).toEqual([ids[0]]);
    expect(await list({ filters: { campo_inexistente: 'x' } })).toHaveLength(5); // se ignora
    expect(await list({ filters: { direccion: '100%' } })).toEqual([]); // % escapado
    expect(await list({ hasCoordinates: true })).toEqual([ids[0], ids[1]]);
    expect(await list({ hasCoordinates: false })).toEqual([ids[2], ids[3], ids[4]]);
    expect(await list({ coordsSource: 'own' })).toEqual([ids[1]]);
    expect(await list({ hasNumber: true })).toEqual([ids[0], ids[1], ids[2]]);
    expect(await list({ hasNumber: false })).toEqual([ids[3], ids[4]]);
  });

  it('search ILIKE sobre rol, comentarios y atributos', async () => {
    const { layer, ids } = await seed();
    const search = (q: string) =>
      recordsService.listRecords(db, layer.id, { ...baseQuery, sort: 'id', dir: 'asc', search: q }).then((r) => r.data.map((x) => x.id));
    expect(await search('50-2')).toEqual([ids[2]]); // rol (contiene)
    expect(await search('antiguo')).toEqual([ids[0]]); // comentarios
    expect(await search('morros')).toEqual([ids[3]]); // atributo
    expect(await search('GALP')).toEqual([ids[3]]); // case-insensitive
    expect(await search('nada que ver')).toEqual([]);
  });
});

describe('createRecord / getRecord', () => {
  it('valida requeridos, castea por tipo y filtra claves desconocidas', async () => {
    const layer = await createLayer({
      fields: [field('direccion', 'Dirección', 'string', { required: true }), field('m2', 'Superficie', 'number'), field('fecha', 'Fecha', 'date'), field('ok', 'Aprobado', 'boolean')],
    });
    const err = await recordsService.createRecord(db, editor, { layerId: layer.id, attributes: { m2: '1.234,5' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain('Dirección');

    await expect(recordsService.createRecord(db, editor, { layerId: layer.id, attributes: { direccion: 'x', m2: 'abc' } })).rejects.toBeInstanceOf(
      ValidationError,
    );

    const rec = await recordsService.createRecord(db, editor, {
      layerId: layer.id,
      attributes: { direccion: '  Riquelme 111 ', m2: '1.234,5', fecha: '15/03/2024', ok: 'sí', desconocido: 'fuera' },
      comments: 'hola',
    });
    expect(rec.attributes).toEqual({ direccion: 'Riquelme 111', m2: 1234.5, fecha: '2024-03-15', ok: true });
    expect(rec.createdBy).toBe(editor.userId);
    expect(rec.comments).toBe('hola');
    await expect(recordsService.createRecord(db, editor, { layerId: 99999, attributes: {} })).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordsService.createRecord(db, editor, { layerId: layer.id, roleId: 'abc', attributes: { direccion: 'x' } })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('el correlativo no se puede fijar desde el formulario; se asigna con la acción explícita', async () => {
    const layer = await createLayer({ fields: [field('n_permiso', 'N° Permiso', 'autonumber'), field('obs', 'Obs')] });
    const rec = await recordsService.createRecord(db, editor, { layerId: layer.id, attributes: { n_permiso: 999, obs: 'a' } });
    expect(rec.attributes.n_permiso).toBeUndefined();
  });

  it('getRecord trae role, layer, attachments y sameRoleCount; updateRecord mezcla atributos', async () => {
    const layer = await createLayer({ fields });
    const other = await createLayer({ fields, name: 'Otra capa' });
    await createRole(ROLE, { ...IN_COMUNA, address: 'RIQUELME 111' });
    const rec = await recordsService.createRecord(db, editor, { layerId: layer.id, roleId: ROLE, attributes: { tipo: 'Casa', m2: 10 } });
    await insertRecord({ layerId: layer.id, roleId: ROLE });
    await insertRecord({ layerId: other.id, roleId: ROLE });
    await attachmentsService.addLink(db, editor, { entityType: 'record', entityId: String(rec.id), title: 'Expediente', url: 'https://example.com/e' });

    const detail = await recordsService.getRecord(db, rec.id);
    expect(detail.role?.id).toBe(ROLE);
    expect(detail.role?.address).toBe('RIQUELME 111');
    expect(detail.role?.vigente).toBe(true);
    expect(detail.layer).toMatchObject({ id: layer.id, name: layer.name, hasRole: true });
    expect(detail.layer.fields).toHaveLength(fields.length);
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0]?.title).toBe('Expediente');
    expect(detail.sameRoleCount).toBe(2);
    expect(detail.backsOperation).toBeNull();
    expect(detail.roleLastOperation).toBeNull();

    const updated = await recordsService.updateRecord(db, editor, rec.id, { attributes: { m2: '20,5' }, comments: 'c' });
    expect(updated.attributes).toEqual({ tipo: 'Casa', m2: 20.5 });
    expect(updated.comments).toBe('c');
    await expect(recordsService.getRecord(db, 99999)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('deleteRecord', () => {
  it('borra el registro y sus adjuntos; con correlativo exige admin y motivo', async () => {
    const layer = await createLayer({ fields });
    const plain = await insertRecord({ layerId: layer.id });
    await attachmentsService.addLink(db, editor, { entityType: 'record', entityId: String(plain.id), title: 'L', url: 'https://example.com' });
    await recordsService.deleteRecord(db, editor, plain.id);
    expect(await getRecordRow(plain.id)).toBeNull();
    expect(await attachmentsService.listAttachments(db, 'record', String(plain.id))).toEqual([]);

    const numbered = await insertRecord({ layerId: layer.id, attributes: { n_permiso: 5 }, numberAssignedAt: new Date() });
    await expect(recordsService.deleteRecord(db, editor, numbered.id, 'motivo')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordsService.deleteRecord(db, admin, numbered.id)).rejects.toBeInstanceOf(ValidationError);
    await recordsService.deleteRecord(db, admin, numbered.id, 'Permiso anulado');
    expect(await getRecordRow(numbered.id)).toBeNull();
    await expect(recordsService.deleteRecord(db, admin, numbered.id, 'x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getFilterOptions (§7.5)', () => {
  it('lista valores distintos (con "" como vacío) y "text" sobre 100 valores', async () => {
    const layer = await createLayer({ fields: [field('tipo', 'Tipo'), field('folio', 'Folio')] });
    const many = Array.from({ length: 120 }, (_, i) => ({ layerId: layer.id, attributes: { tipo: i % 2 ? 'Casa' : 'Local', folio: `F-${i}` } }));
    many.push({ layerId: layer.id, attributes: { tipo: '', folio: 'x' } } as (typeof many)[number]);
    await insertRecords(many);
    filtersService.invalidateFilterOptions(layer.id);
    const opts = await filtersService.getFilterOptions(db, layer.id);
    expect(opts.tipo).toEqual(['', 'Casa', 'Local']);
    expect(opts.folio).toBe('text');
  });
});

describe('exportCsv (§7.6)', () => {
  it('produce BOM, cabeceras correctas y todas las filas (más de un lote)', async () => {
    const layer = await createLayer({ fields: [field('n_permiso', 'N° Permiso', 'number'), field('direccion', 'Dirección')], hasRole: true });
    await createRole(ROLE, IN_COMUNA);
    const total = 2500;
    await insertRecords(
      Array.from({ length: total }, (_, i) => ({
        layerId: layer.id,
        roleId: i === 0 ? ROLE : null,
        lat: i === 0 ? IN_COMUNA.lat : null,
        lon: i === 0 ? IN_COMUNA.lon : null,
        coordsSource: i === 0 ? ('role' as const) : null,
        attributes: { n_permiso: i + 1, direccion: i === 1 ? 'Calle "La Paz"; depto 3' : `Calle ${i}` },
        comments: i === 2 ? 'línea 1\nlínea 2' : null,
      })),
    );

    const { stream, fileName } = await exportService.exportCsv(db, layer.id, { delimiter: ';' });
    expect(fileName).toMatch(new RegExp(`^export-${layer.slug}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.csv$`));
    const text = await readStream(stream);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('id;roleId;lat;lon;origen_coordenadas;N° Permiso;Dirección;comments');
    expect(lines.at(-1)).toBe('');
    // la fila con salto de línea en comments queda entrecomillada: cuenta de filas lógicas = total
    const body = lines.slice(1, -1).join('\r\n');
    const firstRow = body.split('\r\n')[0]!;
    expect(firstRow).toBe(`1;${ROLE};${IN_COMUNA.lat};${IN_COMUNA.lon};Del rol;1;Calle 0;`);
    expect(body).toContain('"Calle ""La Paz""; depto 3"');
    expect(body).toContain('"línea 1\nlínea 2"');
    const idsExported = [...body.matchAll(/(?:^|\r\n)(\d+);/g)].map((m) => Number(m[1]));
    expect(idsExported).toHaveLength(total);
    expect(idsExported.at(-1)).toBe(total);

    const comma = await exportService.exportCsv(db, layer.id, { delimiter: ',' });
    const text2 = await readStream(comma.stream);
    expect(text2.split('\r\n')[0]).toContain('id,roleId,lat,lon');
    await expect(exportService.exportCsv(db, 99999, { delimiter: ';' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('guarda como texto las celdas que una planilla leería como fórmula, sin tocar los números negativos', async () => {
    const layer = await createLayer({ hasRole: false, fields: [field('nota', '=Nota'), field('monto', 'Monto', 'number')] });
    const notas = ['=1+1', '@SUM(A1)', '+HYPERLINK("http://x")', '-5 años'];
    await insertRecords(
      notas.map((nota, i) => ({
        layerId: layer.id,
        lat: -33.565407,
        lon: -70.66,
        coordsSource: 'own' as const,
        attributes: { nota, monto: -1234.5 - i },
      })),
    );

    const { stream } = await exportService.exportCsv(db, layer.id, { delimiter: ';' });
    const lines = (await readStream(stream)).replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe("id;lat;lon;origen_coordenadas;'=Nota;Monto;comments");
    const cells = lines.slice(1, -1).map((l) => l.split(';'));
    expect(cells.map((c) => c[4])).toEqual(["'=1+1", "'@SUM(A1)", `"'+HYPERLINK(""http://x"")"`, "'-5 años"]);
    for (const c of cells) {
      expect(c[1]).toBe('-33.565407');
      expect(c[2]).toBe('-70.66');
      expect(c[5]).toMatch(/^-\d/);
    }
  });
});

describe('rendimiento (Fase 5)', () => {
  it.skipIf(!process.env.PERF)('40k registros: página de 50 < 300 ms y getFeatures < 2 s', async () => {
    const layer = await createLayer({ fields, heatmapFieldKey: 'm2' });
    const N = 40_000;
    const tipos = ['Casa', 'Local', 'Galpón', 'Depto'];
    await insertRecords(
      Array.from({ length: N }, (_, i) => ({
        layerId: layer.id,
        lat: IN_COMUNA.lat + ((i % 200) - 100) * 0.0002,
        lon: IN_COMUNA.lon + ((Math.floor(i / 200) % 200) - 100) * 0.0003,
        coordsSource: 'own' as const,
        attributes: { n_permiso: i + 1, tipo: tipos[i % 4], m2: (i % 500) + 10, direccion: `Calle ${i % 1000} N° ${i}` },
      })),
      2000,
    );
    // estadísticas al día (lo que haría autovacuum tras una importación) y calentamiento
    await db.execute(sql`ANALYZE records`);
    await recordsService.listRecords(db, layer.id, { ...baseQuery, page: 2 });

    // criterio de la Fase 5: una página de 50 (orden por defecto, con filtro por valor) < 300 ms
    let t = performance.now();
    const page = await recordsService.listRecords(db, layer.id, { ...baseQuery, page: 10, filters: { tipo: ['Casa'] } });
    const listMs = performance.now() - t;
    expect(page.data).toHaveLength(50);
    expect(page.total).toBe(N / 4);
    expect(listMs).toBeLessThan(300);

    // búsqueda de texto libre: `attributes::text ILIKE` recorre toda la capa (sin índice trigram sobre el JSONB,
    // §7.3 "índices trigram si el rendimiento lo exige"). Con 40k registros ronda 0,7 s; se vigila que no se degrade.
    // 'Calle 7' calza con Calle 7, 70-79 y 700-799 → 111 de cada 1000 → 4.440 registros
    t = performance.now();
    const searched = await recordsService.listRecords(db, layer.id, { ...baseQuery, page: 40, search: 'Calle 7' });
    const searchMs = performance.now() - t;
    expect(searched.data).toHaveLength(50);
    expect(searched.total).toBe(4440);
    expect(searchMs).toBeLessThan(1500);

    // caso exigente: filtro por valores + orden por un atributo numérico (expresión JSONB sin índice, seq scan + top-N)
    t = performance.now();
    const hard = await recordsService.listRecords(db, layer.id, { ...baseQuery, page: 100, sort: 'attr:m2', dir: 'desc', filters: { tipo: ['Casa', 'Local'] } });
    const hardMs = performance.now() - t;
    expect(hard.data).toHaveLength(50);
    expect(hard.total).toBe(N / 2);
    expect(hardMs).toBeLessThan(600);

    t = performance.now();
    const fc = await recordsService.getFeatures(db, layer.id, { filters: {}, weight: true });
    const featMs = performance.now() - t;
    expect(fc.features).toHaveLength(N);
    expect(featMs).toBeLessThan(2000);
  }, 180_000);
});
