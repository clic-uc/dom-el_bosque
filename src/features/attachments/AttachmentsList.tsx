'use client';

import type { AttachmentEntityType } from '@/shared/schemas/attachments';

/**
 * CONTRATO (fase 9): lista de adjuntos (enlaces y archivos) de un registro o polígono (§10.6).
 * Este archivo es un stub; la implementación real lo reemplaza manteniendo estas props.
 */
export type AttachmentsListProps = {
  entityType: AttachmentEntityType;
  entityId: string;
  /** editor/admin pueden agregar y eliminar. */
  canEdit: boolean;
  className?: string;
};

export function AttachmentsList(_props: AttachmentsListProps) {
  return null;
}
