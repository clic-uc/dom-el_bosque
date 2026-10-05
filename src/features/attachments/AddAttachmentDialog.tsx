'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { attachmentAllowedExtensions } from '@/shared/constants';
import { createLinkAttachmentSchema, type AttachmentEntityType } from '@/shared/schemas/attachments';
import type { AttachmentDto } from '@/shared/types';

export type AddAttachmentMode = 'link' | 'file';

/** Límite por defecto (`MAX_ATTACHMENT_MB`, §12.1). El servidor valida con el valor real de su entorno. */
const MAX_MB = 20;
const ACCEPT = attachmentAllowedExtensions.map((e) => `.${e}`).join(',');
const TYPES_TEXT = 'PDF, imágenes (JPG, PNG, GIF, WEBP, TIFF), Word, Excel, PowerPoint y planos DWG/DXF';

const linkFormSchema = createLinkAttachmentSchema.pick({ title: true, url: true });
type LinkForm = z.infer<typeof linkFormSchema>;

const fileFormSchema = z.object({ title: z.string().trim().min(1, 'Escribe un título').max(200) });
type FileForm = z.infer<typeof fileFormSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AddAttachmentMode;
  entityType: AttachmentEntityType;
  entityId: string;
};

function validateFile(file: File): string | null {
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > MAX_MB * 1024 * 1024) return `El archivo pesa ${formatBytes(file.size)} y el máximo es ${MAX_MB} MB.`;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(attachmentAllowedExtensions as readonly string[]).includes(ext)) return `Tipo de archivo no permitido (.${ext || '?'}). Se aceptan ${TYPES_TEXT}.`;
  return null;
}

/** "+ Agregar enlace" (título + URL) y "+ Subir archivo" (título + archivo con límite y tipos explicados) (§10.6). */
export function AddAttachmentDialog({ open, onOpenChange, mode, entityType, entityId }: Props) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const linkForm = useForm<LinkForm>({ resolver: zodResolver(linkFormSchema), defaultValues: { title: '', url: '' } });
  const fileForm = useForm<FileForm>({ resolver: zodResolver(fileFormSchema), defaultValues: { title: '' } });

  /** Cierra y limpia (diferido para no borrar el contenido mientras se anima el cierre). */
  function close() {
    onOpenChange(false);
    setTimeout(() => {
      linkForm.reset();
      fileForm.reset();
      setFile(null);
      setFileError(null);
      if (fileInput.current) fileInput.current.value = '';
    }, 200);
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.attachments.list(entityType, entityId) });

  const linkMutation = useMutation({
    mutationFn: (v: LinkForm) => api<AttachmentDto>('/api/attachments', { method: 'POST', json: { ...v, entityType, entityId } }),
    onSuccess: (a) => {
      void invalidate();
      toast.success(`Enlace "${a.title}" agregado.`);
      close();
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo agregar el enlace. Revisa la dirección e intenta de nuevo.')),
  });

  const fileMutation = useMutation({
    mutationFn: ({ title, file }: { title: string; file: File }) => {
      const fd = new FormData();
      fd.set('title', title);
      fd.set('entityType', entityType);
      fd.set('entityId', entityId);
      fd.set('file', file, file.name);
      return api<AttachmentDto>('/api/attachments', { method: 'POST', body: fd });
    },
    onSuccess: (a) => {
      void invalidate();
      toast.success(`Archivo "${a.title}" subido.`);
      close();
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo subir el archivo. Intenta de nuevo.')),
  });

  const pending = linkMutation.isPending || fileMutation.isPending;

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileError(f ? validateFile(f) : null);
    if (f && !fileForm.getValues('title')) {
      fileForm.setValue('title', f.name.replace(/\.[^.]+$/, ''), { shouldValidate: true });
    }
  }

  function submitFile(v: FileForm) {
    if (!file) {
      setFileError('Elige un archivo para subir.');
      return;
    }
    const err = validateFile(file);
    if (err) {
      setFileError(err);
      return;
    }
    fileMutation.mutate({ title: v.title, file });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle className="text-xl">{mode === 'link' ? 'Agregar enlace' : 'Subir archivo'}</DialogTitle>
          <DialogDescription className="text-base">
            {mode === 'link'
              ? 'Un enlace a un documento que ya está en línea, por ejemplo en Google Drive.'
              : `Hasta ${MAX_MB} MB. Se aceptan ${TYPES_TEXT}.`}
          </DialogDescription>
        </DialogHeader>

        {mode === 'link' ? (
          <Form {...linkForm}>
            <form onSubmit={linkForm.handleSubmit((v) => linkMutation.mutate(v))} className="space-y-5" noValidate>
              <FormField
                control={linkForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Título</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-12 text-base" placeholder="Ej.: Plano de loteo" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={linkForm.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Dirección del enlace</FormLabel>
                    <FormControl>
                      <Input {...field} type="url" inputMode="url" className="h-12 text-base" placeholder="https://…" />
                    </FormControl>
                    <FormDescription>Debe empezar con http:// o https://. Cópiala desde la barra del navegador.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" className="h-11 text-base" onClick={close} disabled={pending}>
                  Cancelar
                </Button>
                <Button type="submit" className="h-11 text-base" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Agregar enlace
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : (
          <Form {...fileForm}>
            <form onSubmit={fileForm.handleSubmit(submitFile)} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="attachment-file" className="text-base">
                  Archivo
                </Label>
                <Input
                  id="attachment-file"
                  ref={fileInput}
                  type="file"
                  accept={ACCEPT}
                  onChange={onPickFile}
                  className="h-12 cursor-pointer py-2.5 text-base file:mr-3 file:h-7 file:rounded-md file:bg-primary-soft file:px-3 file:text-primary-dark"
                  aria-invalid={!!fileError}
                  aria-describedby="attachment-file-help"
                />
                {fileError ? (
                  <p id="attachment-file-help" className="text-sm font-medium text-destructive">
                    {fileError}
                  </p>
                ) : (
                  <p id="attachment-file-help" className="text-sm text-muted-foreground">
                    {file ? `${file.name} · ${formatBytes(file.size)}` : `Máximo ${MAX_MB} MB.`}
                  </p>
                )}
              </div>
              <FormField
                control={fileForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Título</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-12 text-base" placeholder="Ej.: Reglamento de copropiedad" />
                    </FormControl>
                    <FormDescription>Cómo se verá en la lista. Se propone el nombre del archivo.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" className="h-11 text-base" onClick={close} disabled={pending}>
                  Cancelar
                </Button>
                <Button type="submit" className="h-11 text-base" disabled={pending || !!fileError}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Subir archivo
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
