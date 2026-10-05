import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, sqlClient } from '@/db/client';
import { attachments, auditLogs, layers, records } from '@/db/schema';
import { createLinkAttachmentSchema } from '@/shared/schemas/attachments';
import type { Actor } from '../auth/session';
import { NotFoundError, ValidationError } from '../errors';
import { storage } from '../storage';
import * as attachmentsService from './attachments';

// Límite pequeño para probar el tamaño sin crear archivos de 20 MB. Debe fijarse antes de que `@/env` se evalúe.
vi.hoisted(() => {
  process.env.MAX_ATTACHMENT_MB = '1';
  process.env.STORAGE_DIR = './storage/test-attachments';
});

const actor: Actor = { userId: 'u-editor', email: 'editor@test.cl', name: 'Editor', role: 'editor', rawRole: 'editor', mustChangePassword: false };

async function createRecord(): Promise<number> {
  const [layer] = await db
    .insert(layers)
    .values({ slug: 'obras-menores', name: 'Obras Menores', department: 'edificacion' })
    .returning();
  const [rec] = await db.insert(records).values({ layerId: layer!.id, attributes: {} }).returning({ id: records.id });
  return rec!.id;
}

async function createPolygon(): Promise<number> {
  const [row] = await db.execute<{ id: number }>(sql`
    INSERT INTO polygons (kind, code, name, geom)
    VALUES ('sector', 'T1', 'Sector de prueba',
      ST_Multi(ST_GeomFromText('POLYGON((-70.70 -33.58, -70.60 -33.58, -70.60 -33.52, -70.70 -33.52, -70.70 -33.58))', 4326)))
    RETURNING id
  `);
  return row!.id;
}

function makeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes).fill(65)], name, { type });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

describe('attachments.service', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE polygons, records, layers, attachments, audit_logs RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await sqlClient.end();
    await rm(storage.root, { recursive: true, force: true });
  });

  it('usa el directorio de storage de prueba', () => {
    expect(storage.root).toBe(path.resolve(process.cwd(), './storage/test-attachments'));
  });

  it('enlaces: el esquema exige http(s) y el servicio guarda y audita', async () => {
    const recordId = await createRecord();
    const base = { entityType: 'record' as const, entityId: String(recordId), title: 'Plano en Drive' };

    expect(createLinkAttachmentSchema.safeParse({ ...base, url: 'https://drive.google.com/x' }).success).toBe(true);
    expect(createLinkAttachmentSchema.safeParse({ ...base, url: 'ftp://servidor/x' }).success).toBe(false);
    expect(createLinkAttachmentSchema.safeParse({ ...base, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(createLinkAttachmentSchema.safeParse({ ...base, url: 'drive.google.com' }).success).toBe(false);

    const row = await attachmentsService.addLink(db, actor, { ...base, url: 'https://drive.google.com/x' });
    expect(row.kind).toBe('link');
    expect(row.url).toBe('https://drive.google.com/x');
    expect(row.createdBy).toBe('u-editor');

    const list = await attachmentsService.listAttachments(db, 'record', String(recordId));
    expect(list.map((a) => a.id)).toEqual([row.id]);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'ATTACHMENT'));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe('CREATE');
    expect(logs[0]?.layerId).toBe(1);

    await expect(
      attachmentsService.addLink(db, actor, { ...base, entityId: '9999', url: 'https://x.cl' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('archivos: valida tamaño y tipo antes de escribir en el storage', async () => {
    const polygonId = await createPolygon();
    const input = { entityType: 'polygon' as const, entityId: String(polygonId), title: 'Plano de loteo' };

    await expect(attachmentsService.addFile(db, actor, input, makeFile('virus.exe', 'application/octet-stream', 10))).rejects.toBeInstanceOf(ValidationError);
    await expect(attachmentsService.addFile(db, actor, input, makeFile('plano.pdf', 'text/html', 10))).rejects.toBeInstanceOf(ValidationError);
    await expect(attachmentsService.addFile(db, actor, input, makeFile('vacio.pdf', 'application/pdf', 0))).rejects.toBeInstanceOf(ValidationError);
    await expect(
      attachmentsService.addFile(db, actor, input, makeFile('grande.pdf', 'application/pdf', 1024 * 1024 + 1)),
    ).rejects.toThrow(/supera el máximo de 1 MB/);

    expect(await db.select().from(attachments)).toHaveLength(0);
    expect(existsSync(path.join(storage.root, 'attachments'))).toBe(false);
  });

  it('archivos: sube, descarga y elimina (borrando el archivo del disco)', async () => {
    const polygonId = await createPolygon();
    const input = { entityType: 'polygon' as const, entityId: String(polygonId), title: 'Reglamento de copropiedad' };

    const row = await attachmentsService.addFile(db, actor, input, makeFile('reglamento ñ.pdf', 'application/pdf', 2048));
    expect(row.kind).toBe('file');
    expect(row.fileName).toBe('reglamento ñ.pdf');
    expect(row.mimeType).toBe('application/pdf');
    expect(row.sizeBytes).toBe(2048);
    expect(row.storageKey).toBe(`attachments/${row.id}`);
    const filePath = path.join(storage.root, 'attachments', row.id);
    expect(existsSync(filePath)).toBe(true);

    // DWG llega como octet-stream y se acepta por extensión
    const dwg = await attachmentsService.addFile(db, actor, { ...input, title: 'Plano' }, makeFile('plano.dwg', 'application/octet-stream', 100));
    expect(dwg.mimeType).toBe('application/octet-stream');

    const { row: found, stream } = await attachmentsService.getDownload(db, row.id);
    expect(found.id).toBe(row.id);
    const content = await readStream(stream);
    expect(content.length).toBe(2048);
    expect(content[0]).toBe(65);

    await attachmentsService.deleteAttachment(db, actor, row.id);
    expect(existsSync(filePath)).toBe(false);
    expect(await db.select().from(attachments).where(eq(attachments.id, row.id))).toHaveLength(0);
    await expect(attachmentsService.getDownload(db, row.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(attachmentsService.deleteAttachment(db, actor, row.id)).rejects.toBeInstanceOf(NotFoundError);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'ATTACHMENT')).orderBy(auditLogs.createdAt);
    expect(logs.map((l) => l.action)).toEqual(['CREATE', 'CREATE', 'DELETE']);

    // los adjuntos del polígono siguen listándose (queda el DWG)
    const list = await attachmentsService.listAttachments(db, 'polygon', String(polygonId));
    expect(list.map((a) => a.id)).toEqual([dwg.id]);
  });

  it('deleteForEntity borra las filas y devuelve las claves para purgar el storage', async () => {
    const recordId = await createRecord();
    const input = { entityType: 'record' as const, entityId: String(recordId), title: 'Foto' };
    const f = await attachmentsService.addFile(db, actor, input, makeFile('foto.jpg', 'image/jpeg', 512));
    await attachmentsService.addLink(db, actor, { ...input, title: 'Enlace', url: 'https://x.cl' });

    const keys = await attachmentsService.deleteForEntity(db, 'record', [String(recordId)]);
    expect(keys).toEqual([f.storageKey]);
    await attachmentsService.purgeStorageKeys(keys);
    expect(existsSync(path.join(storage.root, 'attachments', f.id))).toBe(false);
    expect(await attachmentsService.listAttachments(db, 'record', String(recordId))).toEqual([]);
  });
});
