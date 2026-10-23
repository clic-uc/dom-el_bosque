'use client';

import { ArrowLeft, X } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Props = {
  title: React.ReactNode;
  /** Línea sobre el título (capa, estado). */
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  /** Ficha desde la que se llegó: muestra "← {label}" para volver a ella. */
  back?: { label: string; onBack: () => void } | null;
  /** 880 px (registro) o 1040 px (rol). */
  size?: 'md' | 'lg';
  onRequestClose: () => void;
  children: React.ReactNode;
  'data-testid'?: string;
};

/**
 * Ficha en modal (registro, rol): título fijo que recibe el foco, cuerpo con scroll y pie de acciones.
 * Pantalla completa en celulares; fondo suave para que el mapa se adivine detrás.
 * El título es siempre el mismo nodo (cargando → cargado) para que el foco no se pierda.
 */
export function EntityDialog({
  title,
  eyebrow,
  subtitle,
  footer,
  back,
  size = 'md',
  onRequestClose,
  children,
  ...rest
}: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onRequestClose()}>
      <DialogContent
        data-testid={rest['data-testid']}
        showCloseButton={false}
        overlayClassName="bg-black/30"
        aria-describedby={undefined}
        onInteractOutside={(e) => {
          // Los avisos (toasts) quedan fuera del modal: tocarlos no debe cerrar la ficha.
          if ((e.target as Element | null)?.closest?.('[data-sonner-toaster]')) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleRef.current?.focus({ preventScroll: true });
        }}
        className={cn(
          'flex max-h-[92dvh] flex-col gap-0 p-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none max-sm:border-0',
          size === 'lg' ? 'sm:max-w-[1040px]' : 'sm:max-w-[880px]',
        )}
      >
        <header className="border-b px-6 pt-4 pb-4">
          {back ? (
            <Button variant="link" className="mb-1 h-11 gap-1.5 px-0 text-base" onClick={back.onBack}>
              <ArrowLeft className="size-5" aria-hidden /> {back.label}
            </Button>
          ) : null}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              {eyebrow}
              <DialogTitle
                ref={titleRef}
                tabIndex={-1}
                className="text-2xl leading-tight font-semibold text-primary-dark outline-none"
              >
                {title}
              </DialogTitle>
              {subtitle}
            </div>
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-11 shrink-0"
              onClick={onRequestClose}
              aria-label="Cerrar la ficha"
            >
              <X className="size-5" aria-hidden />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
        {footer ? <footer className="border-t px-6 py-4">{footer}</footer> : null}
      </DialogContent>
    </Dialog>
  );
}
