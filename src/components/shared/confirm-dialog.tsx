'use client';

import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Explica la consecuencia concreta ("Se eliminarán 120 registros…"). */
  description: React.ReactNode;
  /** Verbo en el botón: "Eliminar capa", "Confirmar cambio". Nunca "Aceptar". */
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: React.ReactNode;
};

/** Confirmación accesible para toda acción destructiva o irreversible (§3.4 punto 32). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  destructive = false,
  pending = false,
  disabled = false,
  onConfirm,
  children,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-base text-foreground/80">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 text-base" disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn('h-11 text-base', destructive && 'bg-destructive text-white hover:bg-destructive/90')}
            disabled={pending || disabled}
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
