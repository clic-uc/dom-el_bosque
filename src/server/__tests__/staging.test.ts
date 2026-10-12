/**
 * Modo staging (Vercel + Neon, docs/STAGING.md) contra BD real: rechazos de adjuntos, filas de más y padrón por la web;
 * importación completa con tareas dentro de la petición (`after()` simulado), archivos en `file_blobs` y sin pg-boss.
 *
 *   DATABASE_URL=postgres://postgres:password@localhost:5432/sigdom_test pnpm vitest run src/server/__tests__/staging.test.ts
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { count, eq, sql } from 'drizzle-orm';
import type * as NextServer from 'next/server';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachments, fileBlobs, imports, records } from '@/db/schema';
import type { Actor } from '@/server/auth/session';
import { UnauthorizedError } from '@/server/errors';

// Antes de cualquier import que lea las capacidades.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_DEPLOY_MODE = 'staging';
});

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

/** `after()` fuera de una petición real: las tareas se acumulan y corren recién con `flushAfter()`. */
const afterTasks = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));

async function flushAfter(): Promise<void> {
  while (afterTasks.length) await afterTasks.shift()!();
}

import { POST as rolesImportPOST } from '@/app/api/roles/import/route';
import { capabilities } from '@/shared/capabilities';
import { csvBuffer, fakeFile, type Cell } from '../import/__tests__/fixtures';
import { startAnalyze } from '../import/analyze';
import { startCommit } from '../import/commit';
import { discardImport, getStatus, listRows } from '../import/review';
import { revertImport } from '../import/revert';
import { uploadImport } from '../import/upload';
import { addFile, addLink, getDownload } from '../services/attachments';
import {
  admin,
  createLayer,
  db,
  editor,
  field,
  insertRecord,
  setupDbSuite,
} from '../services/__tests__/helpers';
import { diskStorage, storage } from '../storage';

setupDbSuite();

beforeEach(() => {
  afterTasks.length = 0;
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_DEPLOY_MODE;
});

const blobCount = async () => Number((await db.select({ n: count() }).from(fileBlobs))[0]!.n);
const importCount = async () => Number((await db.select({ n: count() }).from(imports))[0]!.n);

const layerFields = () => [
  field('n_permiso', 'N° Permiso', 'number', { required: true }),
  field('direccion', 'Dirección'),
];
const HEADERS = ['N° Permiso', 'Dirección', 'Lat', 'Lon'];
const MAPPING = { 'N° Permiso': 'n_permiso', Dirección: 'direccion', Lat: 'lat', Lon: 'lon' };

function rows(n: number): Cell[][] {
  return Array.from({ length: n }, (_, i) => [i + 1, `Calle Falsa ${i + 1}`, -33.56 - i * 0.0001, -70.66]);
}

const analyzeInput = {
  columnMapping: MAPPING,
  duplicateStrategy: 'ask',
  keepExistingOnEmpty: true,
  geocode: true,
  fullReplace: false,
} as const;

describe('modo staging', () => {
  it('las capacidades se leen como staging y el storage es la base de datos', () => {
    expect(capabilities.mode).toBe('staging');
    expect(storage).not.toBe(diskStorage);
  });

  it('adjuntos: rechaza subir y descargar archivos con un mensaje que ofrece el enlace; los enlaces funcionan', async () => {
    const layer = await createLayer({ hasRole: false, fields: layerFields() });
    const rec = await insertRecord({ layerId: layer.id, attributes: { n_permiso: 1 } });
    const pdf = Buffer.from('%PDF-1.4');
    const file = {
      name: 'plano.pdf',
      type: 'application/pdf',
      size: pdf.byteLength,
      arrayBuffer: async () =>
        pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer,
    };

    await expect(
      addFile(db, editor, { entityType: 'record', entityId: String(rec.id), title: 'Plano' }, file),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/no se pueden subir archivos.*enlace/i),
    });
    expect(await blobCount()).toBe(0);

    const link = await addLink(db, editor, {
      entityType: 'record',
      entityId: String(rec.id),
      title: 'Drive',
      url: 'https://drive.example/x',
    });
    expect(link.kind).toBe('link');
    await expect(getDownload(db, link.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(Number((await db.select({ n: count() }).from(attachments))[0]!.n)).toBe(1);
  });

  it('importación: rechaza al subir planillas con más filas o MB que el máximo, sin guardar nada', async () => {
    const layer = await createLayer({ hasRole: false, fields: layerFields() });
    const big = csvBuffer(HEADERS, rows(1001));
    await expect(uploadImport(db, editor, layer.id, fakeFile('grande.csv', big))).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/1\.001 filas.*hasta 1\.000.*Divide la planilla/),
    });

    const heavy = { name: 'pesado.csv', size: 5 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) };
    await expect(uploadImport(db, editor, layer.id, heavy)).rejects.toThrow(/más de 4 MB/);

    expect(await importCount()).toBe(0);
    expect(await blobCount()).toBe(0);
  });

  it('padrón: la carga web se rechaza indicando la alternativa por CLI', async () => {
    session.actor = admin;
    const form = new FormData();
    form.append('file', new File(['roleId;lat;lon\n'], 'padron.csv', { type: 'text/csv' }));
    const res = await rolesImportPOST(
      new NextRequest('http://localhost/api/roles/import', { method: 'POST', body: form }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/roles:import/);
  });

  it('importación completa con tareas dentro de la petición: subir, analizar, confirmar y revertir', async () => {
    const layer = await createLayer({ hasRole: false, fields: layerFields(), addressFieldKey: 'direccion' });
    const data: Cell[][] = [...rows(3), [4, 'Pasaje que nadie conoce 999', null, null]];
    const source = await uploadImport(
      db,
      editor,
      layer.id,
      fakeFile('permisos.csv', csvBuffer(HEADERS, data)),
    );
    await flushAfter(); // limpieza oportunista

    // El archivo vive en la base, no en disco.
    const [imp] = await db.select().from(imports).where(eq(imports.id, source.importId));
    expect(await storage.exists(imp!.fileKey!)).toBe(true);
    expect(existsSync(path.join(diskStorage.root, imp!.fileKey!))).toBe(false);

    await startAnalyze(db, editor, source.importId, analyzeInput);
    expect((await getStatus(db, source.importId)).status).toBe('ANALYZING');
    await flushAfter();

    const analyzed = await getStatus(db, source.importId);
    expect(analyzed.status).toBe('REVIEW');
    expect(analyzed.stalled).toBe(false);
    expect(analyzed.pendingGeocode).toBe(0);
    // Sin OpenStreetMap: la dirección desconocida queda "sin ubicación", no "buscando".
    expect(analyzed.codeCounts.location_missing).toBe(1);
    expect(analyzed.codeCounts.location_pending).toBeUndefined();
    const warnings = await listRows(db, source.importId, { status: 'warning', page: 1, pageSize: 50 });
    expect(warnings.total).toBe(1);

    await startCommit(db, editor, source.importId, { acceptPendingGeocode: false });
    await flushAfter();
    const done = await getStatus(db, source.importId);
    expect(done.status).toBe('COMPLETED');
    expect(done.createdCount).toBe(4);
    expect(await blobCount()).toBe(0); // el archivo se borra al completar

    const reverted = await revertImport(db, editor, source.importId, { force: false });
    expect(reverted.deletedRecords).toBe(4);
    expect(Number((await db.select({ n: count() }).from(records))[0]!.n)).toBe(0);

    // Nada de pg-boss: no se creó la instancia.
    expect(globalThis.__sigdomBoss).toBeUndefined();
  });

  it('un análisis interrumpido se informa, se puede volver a lanzar y también descartar', async () => {
    const layer = await createLayer({ hasRole: false, fields: layerFields() });
    const source = await uploadImport(db, editor, layer.id, fakeFile('a.csv', csvBuffer(HEADERS, rows(2))));
    await startAnalyze(db, editor, source.importId, analyzeInput);
    afterTasks.length = 0; // la función "se cortó": la tarea nunca corre

    // Mientras no pasa el tiempo límite no se puede relanzar.
    await expect(startAnalyze(db, editor, source.importId, analyzeInput)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await getStatus(db, source.importId)).stalled).toBe(false);

    await db
      .update(imports)
      .set({
        progress: sql`jsonb_set(progress, '{startedAt}', to_jsonb(to_char((now() - interval '10 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))`,
      })
      .where(eq(imports.id, source.importId));
    expect((await getStatus(db, source.importId)).stalled).toBe(true);

    await startAnalyze(db, editor, source.importId, analyzeInput);
    await flushAfter();
    const retried = await getStatus(db, source.importId);
    expect(retried.status).toBe('REVIEW');
    expect(retried.stalled).toBe(false);

    // Descartar el borrador borra su archivo de la base.
    await discardImport(db, editor, source.importId);
    expect(await blobCount()).toBe(0);
  });

  it('cada subida descarta los borradores vencidos (no hay worker que agende la limpieza diaria)', async () => {
    const layer = await createLayer({ hasRole: false, fields: layerFields() });
    const old = await uploadImport(db, editor, layer.id, fakeFile('viejo.csv', csvBuffer(HEADERS, rows(1))));
    await flushAfter();
    await db
      .update(imports)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(imports.id, old.importId));

    await uploadImport(db, editor, layer.id, fakeFile('nuevo.csv', csvBuffer(HEADERS, rows(1))));
    await flushAfter();

    const [row] = await db.select().from(imports).where(eq(imports.id, old.importId));
    expect(row!.status).toBe('DISCARDED');
    expect(await blobCount()).toBe(1);
  });
});
