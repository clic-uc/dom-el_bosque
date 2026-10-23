'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  /** Ancho en px (360 registro/polígono, 400 ficha del rol y filtros). */
  width?: 360 | 400;
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  'data-testid'?: string;
};

/**
 * Panel lateral derecho no modal (§10.2): vive dentro del layout, al lado del mapa, para que el mapa siga
 * recibiendo clicks y no quede tapado. Cierra con Escape, mueve el foco al título al abrir y lo anuncia.
 */
export function SidePanel({ title, subtitle, onClose, width = 360, headerExtra, footer, children, className, ...rest }: Props) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid={rest['data-testid']}
      className={cn(
        'z-(--z-index-panel) flex h-full shrink-0 flex-col border-l bg-background shadow-lg',
        'animate-in slide-in-from-right-4 duration-200',
        width === 400 ? 'w-[400px]' : 'w-[360px]',
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-primary-dark outline-none">
            {title}
          </h2>
          {subtitle ? <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
        {headerExtra}
        <Button variant="ghost" size="icon-lg" className="size-11 shrink-0" onClick={onClose} aria-label="Cerrar panel">
          <X className="size-5" aria-hidden />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      {footer ? <footer className="border-t bg-background px-4 py-3">{footer}</footer> : null}
    </aside>
  );
}

/** Bloque con título de sección dentro de un panel. */
export function PanelSection({ title, action, children, className }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
