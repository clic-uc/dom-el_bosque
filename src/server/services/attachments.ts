import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { attachments, polygons, records } from '@/db/schema';
import { env } from '@/env';
import { capabilities } from '@/shared/capabilities';
import { attachmentAllowedExtensions, attachmentAllowedMimeTypes } from '@/shared/constants';
import type { AttachmentEntityType, CreateLinkAttachmentInput } from '@/shared/schemas/attachments';
import type { AttachmentDto, AttachmentRow } from '@/shared/types';
import type { Actor } from '../auth/session';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { detectContentType } from '../file-signature';
import { storage } from '../storage';
import * as audit from './audit';

/** Lo que sale hacia el cliente: sin la clave interna del archivo en el storage. */
function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  const { storageKey: _storageKey, ...dto } = row;
  return { ...dto, createdAt: row.createdAt.toISOString() };
}

export async function listAttachments(db: DbOrTx, entityType: AttachmentEntityType, entityId: string): Promise<AttachmentDto[]> {
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)))
    .orderBy(desc(attachments.createdAt));
  return rows.map(toAttachmentDto);
}

async function assertEntityExists(db: DbOrTx, entityType: AttachmentEntityType, entityId: string): Promise<number | null> {
  const id = Number(entityId);
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError();
  if (entityType === 'record') {
    const [r] = await db.select({ id: records.id, layerId: records.layerId }).from(records).where(eq(records.id, id)).limit(1);
    if (!r) throw new NotFoundError('El registro no existe o fue eliminado');
    return r.layerId;
  }
  const [p] = await db.select({ id: polygons.id }).from(polygons).where(eq(polygons.id, id)).limit(1);
  if (!p) throw new NotFoundError('El polígono no existe');
  return null;
}

export async function addLink(db: DbOrTx, actor: Actor, input: CreateLinkAttachmentInput): Promise<AttachmentDto> {
  const layerId = await assertEntityExists(db, input.entityType, input.entityId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(attachments)
      .values({
        entityType: input.entityType,
        entityId: input.entityId,
        kind: 'link',
        title: input.title,
        url: input.url,
        createdBy: actor.userId,
      })
      .returning();
    await audit.log(tx, {
      actor,
      action: 'CREATE',
      entityType: 'ATTACHMENT',
      entityId: row!.id,
      layerId,
      metadata: { entityType: input.entityType, entityId: input.entityId, kind: 'link', title: input.title },
    });
    return toAttachmentDto(row!);
  });
}

export type FileInput = { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };

/** Tope de un adjunto y su mensaje; lo usa también la ruta para rechazar antes de leer el cuerpo. */
export function attachmentSizeLimit(): { maxBytes: number; message: string } {
  return {
    maxBytes: env.MAX_ATTACHMENT_MB * 1024 * 1024,
    message: `El archivo supera el máximo de ${env.MAX_ATTACHMENT_MB} MB`,
  };
}

export function validateAttachmentFile(file: FileInput): void {
  const { maxBytes, message } = attachmentSizeLimit();
  if (file.size <= 0) throw new ValidationError('El archivo está vacío');
  if (file.size > maxBytes) throw new ValidationError(message);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const extOk = (attachmentAllowedExtensions as readonly string[]).includes(ext);
  const mimeOk = (attachmentAllowedMimeTypes as readonly string[]).includes(file.type) || file.type === '';
  if (!extOk || !mimeOk) {
    throw new ValidationError('Tipo de archivo no permitido. Se aceptan PDF, imágenes, documentos Office y planos DWG/DXF');
  }
}

/** Cómo nombrar cada tipo en el mensaje de rechazo, en palabras de quien usa el sistema. */
const kindLabel: Record<string, string> = {
  pdf: 'un PDF válido',
  doc: 'un documento de Word válido',
  docx: 'un documento de Word válido',
  xls: 'una planilla de Excel válida',
  xlsx: 'una planilla de Excel válida',
  ppt: 'una presentación de PowerPoint válida',
  pptx: 'una presentación de PowerPoint válida',
  dwg: 'un plano DWG válido',
  dxf: 'un plano DXF válido',
};

/**
 * Los primeros bytes deben corresponder a la extensión: un ejecutable renombrado `.pdf` no entra.
 * Devuelve el tipo MIME detectado, que es el que se guarda (no el que declara el navegador).
 */
function contentTypeOrReject(fileName: string, bytes: Uint8Array): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = detectContentType(ext, bytes);
  if (!mimeType) {
    const label = Object.hasOwn(kindLabel, ext) ? kindLabel[ext] : 'una imagen válida';
    throw new ValidationError(`Este archivo no es ${label}. Revisa que sea el archivo correcto e intenta de nuevo.`);
  }
  return mimeType;
}

/** Staging: sin disco persistente no se aceptan archivos (los enlaces sí). */
function assertFileAttachmentsEnabled(): void {
  if (!capabilities.fileAttachments) throw new ConflictError(capabilities.notices.attachments ?? 'No se pueden subir archivos.');
}

export async function addFile(
  db: DbOrTx,
  actor: Actor,
  input: { entityType: AttachmentEntityType; entityId: string; title: string },
  file: FileInput,
): Promise<AttachmentDto> {
  assertFileAttachmentsEnabled();
  validateAttachmentFile(file);
  const layerId = await assertEntityExists(db, input.entityType, input.entityId);
  const content = Buffer.from(await file.arrayBuffer());
  // antes de guardar: un archivo rechazado no llega al storage
  const mimeType = contentTypeOrReject(file.name, content);
  const id = crypto.randomUUID();
  const storageKey = `attachments/${id}`;
  await storage.put(storageKey, content);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(attachments)
        .values({
          id,
          entityType: input.entityType,
          entityId: input.entityId,
          kind: 'file',
          title: input.title,
          storageKey,
          fileName: file.name,
          mimeType,
          sizeBytes: file.size,
          createdBy: actor.userId,
        })
        .returning();
      await audit.log(tx, {
        actor,
        action: 'CREATE',
        entityType: 'ATTACHMENT',
        entityId: row!.id,
        layerId,
        metadata: { entityType: input.entityType, entityId: input.entityId, kind: 'file', title: input.title, fileName: file.name },
      });
      return toAttachmentDto(row!);
    });
  } catch (err) {
    await storage.delete(storageKey);
    throw err;
  }
}

export async function deleteAttachment(db: DbOrTx, actor: Actor, id: string): Promise<void> {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!row) throw new NotFoundError('El adjunto no existe');
  const layerId = row.entityType === 'record' ? await assertEntityExists(db, 'record', row.entityId).catch(() => null) : null;
  await db.transaction(async (tx) => {
    await tx.delete(attachments).where(eq(attachments.id, id));
    await audit.log(tx, {
      actor,
      action: 'DELETE',
      entityType: 'ATTACHMENT',
      entityId: id,
      layerId,
      metadata: { entityType: row.entityType, entityId: row.entityId, title: row.title, kind: row.kind },
    });
  });
  if (row.storageKey) await storage.delete(row.storageKey);
}

export async function getDownload(db: DbOrTx, id: string): Promise<{ row: AttachmentRow; stream: ReadableStream<Uint8Array> }> {
  assertFileAttachmentsEnabled();
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!row || row.kind !== 'file' || !row.storageKey) throw new NotFoundError('El archivo no existe');
  if (!(await storage.exists(row.storageKey))) throw new NotFoundError('El archivo ya no está disponible');
  return { row, stream: storage.getStream(row.storageKey) };
}

/** Borra los adjuntos de una entidad (y sus archivos). Se llama al borrar registros/polígonos. */
export async function deleteForEntity(tx: DbOrTx, entityType: AttachmentEntityType, entityIds: string[]): Promise<string[]> {
  if (entityIds.length === 0) return [];
  const rows = await tx
    .delete(attachments)
    .where(and(eq(attachments.entityType, entityType), inArrayText(attachments.entityId, entityIds)))
    .returning({ storageKey: attachments.storageKey });
  return rows.map((r) => r.storageKey).filter((k): k is string => !!k);
}

function inArrayText(column: typeof attachments.entityId, values: string[]) {
  // drizzle inArray requiere al menos un valor; el caller ya lo garantiza
  return values.length === 1 ? eq(column, values[0]!) : inArrayImport(column, values);
}

import { inArray as inArrayImport } from 'drizzle-orm';

/** Elimina del storage los archivos devueltos por `deleteForEntity` (fuera de la transacción). */
export async function purgeStorageKeys(keys: string[]): Promise<void> {
  await storage.deleteMany(keys);
}
