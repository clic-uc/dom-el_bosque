import { Inbox, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Estados vacío / error / carga reutilizables (§3.4 punto 36). Siempre con texto que explique qué hacer. */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <Icon className="size-10 text-muted-foreground" aria-hidden />
      <p className="text-base font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'No se pudo cargar la información',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}
    >
      <TriangleAlert className="size-10 text-destructive" aria-hidden />
      <p className="text-base font-medium">{title}</p>
      {message ? <p className="max-w-sm text-sm text-muted-foreground">{message}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="lg" onClick={onRetry} className="mt-2">
          <RefreshCw aria-hidden /> Intentar de nuevo
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ rows = 4, label = 'Cargando…', className }: { rows?: number; label?: string; className?: string }) {
  return (
    <div className={cn('space-y-3 p-4', className)} role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
