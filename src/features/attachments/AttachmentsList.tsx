'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, File, FileText, Image as ImageIcon, Link as LinkIcon, Paperclip, Plus, Ruler, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { HelpLink } from '@/features/help/HelpLink';
import { api, errorMessage } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { capabilities } from '@/shared/capabilities';
import type { AttachmentEntityType } from '@/shared/schemas/attachments';
import type { AttachmentDto } from '@/shared/types';
import { AddAttachmentDialog, type AddAttachmentMode } from './AddAttachmentDialog';

export type AttachmentsListProps = {
  entityType: AttachmentEntityType;
  entityId: string;
  /** editor/admin pueden agregar y eliminar. */
  canEdit: boolean;
  className?: string;
};

/** Ícono por tipo (§10.6): enlace, PDF, imagen, plano (DWG/DXF) o archivo genérico. */
export function attachmentIcon(a: Pick<AttachmentDto, 'kind' | 'mimeType' | 'fileName'>): { Icon: LucideIcon; label: string } {
  if (a.kind === 'link') return { Icon: LinkIcon, label: 'Enlace' };
  const ext = a.fileName?.split('.').pop()?.toLowerCase() ?? '';
  const mime = a.mimeType ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return { Icon: FileText, label: 'PDF' };
  if (mime.startsWith('image/') && !['dwg', 'dxf'].includes(ext)) return { Icon: ImageIcon, label: 'Imagen' };
  if (ext === 'dwg' || ext === 'dxf' || mime.includes('dwg') || mime.includes('dxf') || mime.includes('acad')) return { Icon: Ruler, label: 'Plano' };
  return { Icon: File, label: 'Archivo' };
}

/** Lista de adjuntos de un registro o polígono (§10.6): enlaces abren en pestaña nueva; archivos se descargan. */
export function AttachmentsList({ entityType, entityId, canEdit, className }: AttachmentsListProps) {
  const filesEnabled = capabilities.fileAttachments;
  const filesOffId = useId();
  const queryClient = useQueryClient();
  const [addMode, setAddMode] = useState<AddAttachmentMode | null>(null);
  const [toDelete, setToDelete] = useState<AttachmentDto | null>(null);

  const list = useQuery({
    queryKey: queryKeys.attachments.list(entityType, entityId),
    queryFn: () => api<AttachmentDto[]>('/api/attachments', { query: { entityType, entityId } }),
  });

  const deleteMutation = useMutation({
    mutationFn: (a: AttachmentDto) => api<void>(`/api/attachments/${a.id}`, { method: 'DELETE' }),
    onSuccess: (_d, a) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attachments.list(entityType, entityId) });
      setToDelete(null);
      toast.success(`Se eliminó "${a.title}".`);
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo eliminar el adjunto. Intenta de nuevo.')),
  });

  return (
    <section className={cn('space-y-3', className)} aria-label="Documentos adjuntos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          <Paperclip className="size-4 text-muted-foreground" aria-hidden /> Documentos adjuntos
          {list.data && list.data.length > 0 ? <span className="text-sm font-normal text-muted-foreground">({list.data.length})</span> : null}
          <HelpLink slug="mapa/poligonos" label="¿Qué documentos puedo adjuntar?" />
        </h3>
        {canEdit ? (
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" className="h-11 text-sm" onClick={() => setAddMode('link')}>
              <Plus aria-hidden /> Agregar enlace
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 text-sm"
              disabled={!filesEnabled}
              aria-describedby={filesEnabled ? undefined : filesOffId}
              onClick={() => setAddMode('file')}
            >
              <Upload aria-hidden /> Subir archivo
            </Button>
          </div>
        ) : null}
      </div>
      {canEdit && !filesEnabled ? (
        <p id={filesOffId} className="text-sm text-muted-foreground">
          {capabilities.notices.attachments}
        </p>
      ) : null}

      {list.isPending ? (
        <LoadingState rows={2} label="Cargando adjuntos…" className="p-0" />
      ) : list.isError ? (
        <ErrorState title="No se pudieron cargar los adjuntos" message={errorMessage(list.error)} onRetry={() => void list.refetch()} className="py-6" />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title="Sin documentos adjuntos"
          description={
            canEdit
              ? filesEnabled
                ? 'Agrega un enlace (por ejemplo, a Drive) o sube un archivo: planos, reglamentos, certificados, fotos.'
                : 'Agrega un enlace al documento (por ejemplo, a Drive): planos, reglamentos, certificados, fotos.'
              : undefined
          }
          className="rounded-md border border-dashed py-8"
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {list.data.map((a) => {
            const { Icon, label } = attachmentIcon(a);
            const href = a.kind === 'link' ? (a.url ?? '#') : `/api/attachments/${a.id}/download`;
            return (
              <li key={a.id} className="flex items-start gap-3 p-3">
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-dark" title={label}>
                  <Icon className="size-5" aria-hidden />
                  <span className="sr-only">{label}</span>
                </span>
                <div className="min-w-0 flex-1">
                  {a.kind === 'link' ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 text-base font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <span className="break-all">{a.title}</span>
                      <ExternalLink className="size-4 shrink-0" aria-hidden />
                      <span className="sr-only">(se abre en una pestaña nueva)</span>
                    </a>
                  ) : (
                    <a
                      href={href}
                      download={a.fileName ?? undefined}
                      className="inline-flex min-h-11 items-center text-base font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <span className="break-all">{a.title}</span>
                      <span className="sr-only">(descargar)</span>
                    </a>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {a.kind === 'file' ? `${a.fileName ?? ''}${a.sizeBytes ? ` · ${formatBytes(a.sizeBytes)}` : ''} · ` : ''}
                    agregado el {formatDate(a.createdAt)}
                  </p>
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Eliminar ${a.title}`}
                    onClick={() => setToDelete(a)}
                  >
                    <Trash2 className="size-5" aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <>
          <AddAttachmentDialog
            key={addMode ?? 'none'}
            open={addMode !== null}
            onOpenChange={(o) => !o && setAddMode(null)}
            mode={addMode ?? 'link'}
            entityType={entityType}
            entityId={entityId}
          />
          <ConfirmDialog
            open={toDelete !== null}
            onOpenChange={(o) => !o && setToDelete(null)}
            title={`¿Eliminar "${toDelete?.title ?? ''}"?`}
            description={
              toDelete?.kind === 'file'
                ? 'El archivo se borrará definitivamente de la plataforma y nadie podrá volver a descargarlo.'
                : 'El enlace se quitará de este elemento. El documento original en su sitio no se modifica.'
            }
            confirmLabel="Eliminar adjunto"
            destructive
            pending={deleteMutation.isPending}
            onConfirm={() => {
              if (toDelete) deleteMutation.mutate(toDelete);
            }}
          />
        </>
      ) : null}
    </section>
  );
}
