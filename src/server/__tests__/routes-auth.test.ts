/**
 * Autorización de los Route Handlers (§6.2 / §9): se invocan directamente con `getActor` simulado.
 * 401 sin sesión, 403 con rol insuficiente, 200/201/204 con el rol adecuado. Contra BD real para los casos felices.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/session';
import { UnauthorizedError } from '@/server/errors';
import { resetRateLimits } from '@/server/rate-limit';
import { admin, createLayer, createRole, db, editor, field, IN_COMUNA, insertRecord, setupDbSuite, viewer } from '@/server/services/__tests__/helpers';
import * as roleOperationsService from '@/server/services/roleOperations';

const session = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock('@/server/auth/session', () => ({
  getActor: vi.fn(async () => {
    if (!session.actor) throw new UnauthorizedError();
    return session.actor;
  }),
  getOptionalActor: vi.fn(async () => session.actor),
  requireRole: vi.fn(),
  assertRole: vi.fn(),
}));

import { GET as featuresGET } from '@/app/api/layers/[id]/features/route';
import { GET as recordsListGET } from '@/app/api/layers/[id]/records/route';
import { GET as filtersGET } from '@/app/api/layers/[id]/filters/route';
import { GET as exportGET } from '@/app/api/layers/[id]/export/route';
import { POST as recordsPOST } from '@/app/api/records/route';
import { DELETE as recordDELETE, GET as recordGET, PATCH as recordPATCH } from '@/app/api/records/[id]/route';
import { PATCH as coordinatesPATCH } from '@/app/api/records/[id]/coordinates/route';
import { POST as numberPOST, PUT as numberPUT } from '@/app/api/records/[id]/number/route';
import { GET as rolesGET } from '@/app/api/roles/route';
import { POST as rolesImportPOST } from '@/app/api/roles/import/route';
import { DELETE as roleDELETE, GET as roleGET, PATCH as rolePATCH } from '@/app/api/roles/[roleId]/route';
import { GET as roleRecordsGET } from '@/app/api/roles/[roleId]/records/route';
import { GET as opsGET, POST as opsPOST } from '@/app/api/role-operations/route';
import { DELETE as opDELETE } from '@/app/api/role-operations/[id]/route';
import { GET as geocodeGET } from '@/app/api/geocode/route';

setupDbSuite();

type Ctx<P extends Record<string, string>> = { params: Promise<P> };

function req(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): NextRequest {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers['content-type'] = 'application/json';
  }
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? 'GET', body, headers });
}

const ctx = <P extends Record<string, string>>(params: P): Ctx<P> => ({ params: Promise.resolve(params) });

function as(actor: Actor | null) {
  session.actor = actor;
}

async function errorCode(res: Response): Promise<string | undefined> {
  const json = (await res.json()) as { error?: { code?: string } };
  return json.error?.code;
}

describe('sin sesión → 401', () => {
  it('GET features, GET record, GET roles, GET geocode', async () => {
    as(null);
    const r1 = await featuresGET(req('/api/layers/1/features'), ctx({ id: '1' }));
    expect(r1.status).toBe(401);
    expect(await errorCode(r1)).toBe('UNAUTHORIZED');
    expect((await recordGET(req('/api/records/1'), ctx({ id: '1' }))).status).toBe(401);
    expect((await rolesGET(req('/api/roles?q=50'), ctx({}))).status).toBe(401);
    expect((await geocodeGET(req('/api/geocode?q=riquelme 111'), ctx({}))).status).toBe(401);
    expect((await opsGET(req('/api/role-operations'), ctx({}))).status).toBe(401);
  });
});

describe('viewer', () => {
  it('lee (200) pero no escribe (403)', async () => {
    const layer = await createLayer({ fields: [field('tipo', 'Tipo')] });
    await createRole('00050-00001', IN_COMUNA);
    const rec = await insertRecord({ layerId: layer.id, roleId: '00050-00001', ...IN_COMUNA, coordsSource: 'role', attributes: { tipo: 'Casa' } });
    as(viewer);

    const features = await featuresGET(req(`/api/layers/${layer.id}/features`), ctx({ id: String(layer.id) }));
    expect(features.status).toBe(200);
    expect(features.headers.get('cache-control')).toBe('private, no-store');
    expect(((await features.json()) as { features: unknown[] }).features).toHaveLength(1);

    const list = await recordsListGET(req(`/api/layers/${layer.id}/records?pageSize=10&filters[tipo]=Casa`), ctx({ id: String(layer.id) }));
    expect(list.status).toBe(200);
    expect((await list.json()) as { total: number }).toMatchObject({ total: 1, page: 1, pageSize: 10 });

    expect((await filtersGET(req(`/api/layers/${layer.id}/filters`), ctx({ id: String(layer.id) }))).status).toBe(200);

    const csv = await exportGET(req(`/api/layers/${layer.id}/export?delimiter=;`), ctx({ id: String(layer.id) }));
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toMatch(/^attachment; filename="export-.*\.csv"$/);
    expect(await csv.text()).toContain('id;roleId;lat;lon');

    expect((await recordGET(req(`/api/records/${rec.id}`), ctx({ id: String(rec.id) }))).status).toBe(200);
    expect((await roleGET(req('/api/roles/50-1'), ctx({ roleId: '50-1' }))).status).toBe(200);
    expect((await roleRecordsGET(req('/api/roles/50-1/records?includeLineage=true'), ctx({ roleId: '50-1' }))).status).toBe(200);
    expect((await rolesGET(req('/api/roles?q=50-1'), ctx({}))).status).toBe(200);
    expect((await opsGET(req('/api/role-operations?page=1'), ctx({}))).status).toBe(200);

    // escrituras prohibidas
    const create = await recordsPOST(req('/api/records', { method: 'POST', body: { layerId: layer.id, attributes: {} } }), ctx({}));
    expect(create.status).toBe(403);
    expect(await errorCode(create)).toBe('FORBIDDEN');
    expect((await recordPATCH(req(`/api/records/${rec.id}`, { method: 'PATCH', body: { comments: 'x' } }), ctx({ id: String(rec.id) }))).status).toBe(403);
    expect((await recordDELETE(req(`/api/records/${rec.id}`, { method: 'DELETE' }), ctx({ id: String(rec.id) }))).status).toBe(403);
    expect((await coordinatesPATCH(req(`/api/records/${rec.id}/coordinates`, { method: 'PATCH', body: { useRole: true } }), ctx({ id: String(rec.id) }))).status).toBe(403);
    expect((await numberPOST(req(`/api/records/${rec.id}/number`, { method: 'POST' }), ctx({ id: String(rec.id) }))).status).toBe(403);
    expect((await rolePATCH(req('/api/roles/50-1', { method: 'PATCH', body: { address: 'x' } }), ctx({ roleId: '50-1' }))).status).toBe(403);
    expect((await roleDELETE(req('/api/roles/50-1', { method: 'DELETE' }), ctx({ roleId: '50-1' }))).status).toBe(403);
    expect((await opsPOST(req('/api/role-operations', { method: 'POST', body: {} }), ctx({}))).status).toBe(403);
    expect((await rolesImportPOST(req('/api/roles/import', { method: 'POST' }), ctx({}))).status).toBe(403);
  });
});

describe('editor', () => {
  it('crea (201), edita (200), asigna número (200) y borra (204); lo exclusivo de admin da 403', async () => {
    const layer = await createLayer({ fields: [field('n_permiso', 'N° Permiso', 'autonumber'), field('tipo', 'Tipo')] });
    await createRole('00050-00001', IN_COMUNA);
    as(editor);

    const create = await recordsPOST(
      req('/api/records', { method: 'POST', body: { layerId: layer.id, roleId: '50-1', attributes: { tipo: 'Casa' } } }),
      ctx({}),
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: number; roleId: string; coordsSource: string };
    expect(created.roleId).toBe('00050-00001');
    expect(created.coordsSource).toBe('role');

    const patch = await recordPATCH(req(`/api/records/${created.id}`, { method: 'PATCH', body: { comments: 'editado' } }), ctx({ id: String(created.id) }));
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { comments: string }).comments).toBe('editado');

    const coords = await coordinatesPATCH(
      req(`/api/records/${created.id}/coordinates`, { method: 'PATCH', body: { lat: -33.57, lon: -70.67, scope: 'record' } }),
      ctx({ id: String(created.id) }),
    );
    expect(coords.status).toBe(200);
    expect(await coords.json()).toEqual({ updated: 1 });

    const number = await numberPOST(req(`/api/records/${created.id}/number`, { method: 'POST' }), ctx({ id: String(created.id) }));
    expect(number.status).toBe(200);
    expect(await number.json()).toEqual({ number: 1, fieldKey: 'n_permiso' });

    // corregir el número es solo de admin
    const put = await numberPUT(req(`/api/records/${created.id}/number`, { method: 'PUT', body: { value: 5, reason: 'x' } }), ctx({ id: String(created.id) }));
    expect(put.status).toBe(403);

    // con correlativo asignado, el editor no puede borrar (lo exige el servicio)
    const del = await recordDELETE(req(`/api/records/${created.id}`, { method: 'DELETE', body: { reason: 'x' } }), ctx({ id: String(created.id) }));
    expect(del.status).toBe(403);

    const plain = await insertRecord({ layerId: layer.id });
    const del2 = await recordDELETE(req(`/api/records/${plain.id}`, { method: 'DELETE' }), ctx({ id: String(plain.id) }));
    expect(del2.status).toBe(204);

    const rolePatch = await rolePATCH(req('/api/roles/50-1', { method: 'PATCH', body: { address: 'Riquelme 111' } }), ctx({ roleId: '50-1' }));
    expect(rolePatch.status).toBe(200);
    expect(((await rolePatch.json()) as { streetNorm: string }).streetNorm).toBe('riquelme');

    const op = await opsPOST(
      req('/api/role-operations', {
        method: 'POST',
        body: { type: 'subdivision', effectiveDate: '2024-01-01', originRoleIds: ['50-1'], resultRoleIds: ['50-10', '50-11'] },
      }),
      ctx({}),
    );
    expect(op.status).toBe(201);
    const opBody = (await op.json()) as { id: number; originRoleIds: string[] };
    expect(opBody.originRoleIds).toEqual(['00050-00001']);

    // DELETE role-operations como editor → 403
    const delOp = await opDELETE(req(`/api/role-operations/${opBody.id}`, { method: 'DELETE', body: { reason: 'error' } }), ctx({ id: String(opBody.id) }));
    expect(delOp.status).toBe(403);
    expect((await rolesImportPOST(req('/api/roles/import', { method: 'POST' }), ctx({}))).status).toBe(403);
  });
});

describe('admin', () => {
  it('elimina operaciones (204), corrige números (200) e importa el padrón (200)', async () => {
    const layer = await createLayer({ fields: [field('n_permiso', 'N° Permiso', 'autonumber')] });
    await createRole('00050-00001', IN_COMUNA);
    const op = await roleOperationsService.createOperation(db, admin, {
      type: 'subdivision',
      effectiveDate: '2024-01-01',
      originRoleIds: ['00050-00001'],
      resultRoleIds: ['00050-00010', '00050-00011'],
      resultCoords: 'none',
    });
    const rec = await insertRecord({ layerId: layer.id });
    as(admin);

    // motivo obligatorio
    const noReason = await opDELETE(req(`/api/role-operations/${op.id}`, { method: 'DELETE', body: {} }), ctx({ id: String(op.id) }));
    expect(noReason.status).toBe(400);
    expect(await errorCode(noReason)).toBe('VALIDATION');
    const del = await opDELETE(req(`/api/role-operations/${op.id}`, { method: 'DELETE', body: { reason: 'Registrada por error' } }), ctx({ id: String(op.id) }));
    expect(del.status).toBe(204);
    const gone = await opDELETE(req(`/api/role-operations/${op.id}`, { method: 'DELETE', body: { reason: 'otra vez' } }), ctx({ id: String(op.id) }));
    expect(gone.status).toBe(404);

    const put = await numberPUT(req(`/api/records/${rec.id}/number`, { method: 'PUT', body: { value: 77, reason: 'Entregado en Excel' } }), ctx({ id: String(rec.id) }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ number: 77 });

    const form = new FormData();
    form.append('file', new File([`roleId;lat;lon\n50-1;${IN_COMUNA.lat};${IN_COMUNA.lon}\n`], 'padron.csv', { type: 'text/csv' }));
    const imp = await rolesImportPOST(req('/api/roles/import', { method: 'POST', form }), ctx({}));
    expect(imp.status).toBe(200);
    expect((await imp.json()) as { upsertedRoles: number }).toMatchObject({ upsertedRoles: 1 });

    const noFile = await rolesImportPOST(req('/api/roles/import', { method: 'POST', form: new FormData() }), ctx({}));
    expect(noFile.status).toBe(400);

    const delRole = await roleDELETE(req('/api/roles/50-11', { method: 'DELETE' }), ctx({ roleId: '50-11' }));
    expect(delRole.status).toBe(204);
  });
});

describe('validación de parámetros y errores tipados', () => {
  it('ids y roles inválidos → 400; inexistentes → 404; conflicto → 409', async () => {
    as(admin);
    expect((await recordGET(req('/api/records/abc'), ctx({ id: 'abc' }))).status).toBe(400);
    expect((await recordGET(req('/api/records/999999'), ctx({ id: '999999' }))).status).toBe(404);
    const badRole = await roleGET(req('/api/roles/abc'), ctx({ roleId: 'abc' }));
    expect(badRole.status).toBe(400);
    expect(await errorCode(badRole)).toBe('VALIDATION');
    expect((await roleGET(req('/api/roles/99999-99999'), ctx({ roleId: '99999-99999' }))).status).toBe(404);
    expect((await featuresGET(req('/api/layers/0/features'), ctx({ id: '0' }))).status).toBe(400);
    expect((await rolesGET(req('/api/roles'), ctx({}))).status).toBe(400); // q obligatorio

    const layer = await createLayer({ fields: [field('n_permiso', 'N° Permiso', 'number')], uniqueKeys: ['n_permiso'] });
    await createRole('00050-00001');
    const body = { layerId: layer.id, roleId: '50-1', attributes: { n_permiso: 1 } };
    expect((await recordsPOST(req('/api/records', { method: 'POST', body }), ctx({}))).status).toBe(201);
    const dup = await recordsPOST(req('/api/records', { method: 'POST', body }), ctx({}));
    expect(dup.status).toBe(409);
    const dupBody = (await dup.json()) as { error: { code: string; details: { kind: string } } };
    expect(dupBody.error.code).toBe('CONFLICT');
    expect(dupBody.error.details.kind).toBe('duplicate');

    const badOp = await opsPOST(
      req('/api/role-operations', { method: 'POST', body: { type: 'subdivision', effectiveDate: '2024-01-01', originRoleIds: ['50-1'], resultRoleIds: ['50-2'] } }),
      ctx({}),
    );
    expect(badOp.status).toBe(400);
  });

  it('geocode: 200 con null si no hay resultado y 429 al superar 30/min', async () => {
    resetRateLimits();
    as(viewer);
    await createRole('00001-00001', { ...IN_COMUNA, address: 'RIQUELME 111' });
    const hit = await geocodeGET(req('/api/geocode?q=Riquelme 111'), ctx({}));
    expect(hit.status).toBe(200);
    expect((await hit.json()) as { roleId: string }).toMatchObject({ provider: 'padron', confidence: 'exact', roleId: '00001-00001' });
    const miss = await geocodeGET(req('/api/geocode?q=Calle Inexistente 999'), ctx({}));
    expect(miss.status).toBe(200);
    expect(await miss.json()).toBeNull();
    expect((await geocodeGET(req('/api/geocode?q=ab'), ctx({}))).status).toBe(400);

    let last: Response | null = null;
    for (let i = 0; i < 30; i++) last = await geocodeGET(req('/api/geocode?q=Riquelme 111'), ctx({}));
    expect(last!.status).toBe(429);
    expect(await errorCode(last!)).toBe('RATE_LIMITED');
    resetRateLimits();
  });
});
