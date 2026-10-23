'use client';

import { FlaskConical, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { HelpLink } from '@/features/help/HelpLink';
import { capabilities } from '@/shared/capabilities';

/** Alto fijo del aviso; las vistas de pantalla completa lo descuentan con `h-app` / `min-h-app`. */
export const STAGING_BANNER_HEIGHT = '2.75rem';

// El aviso cerrado se recuerda solo durante la sesión del navegador: al volver a abrir la plataforma
// reaparece, para que nadie trabaje en pruebas creyendo que está en la oficial. Si el navegador bloquea
// el almacenamiento, queda cerrado hasta recargar la página.
const DISMISS_KEY = 'sigdom:staging-banner-cerrado';
let dismissedInMemory = false;
const listeners = new Set<() => void>();

function isDismissed(): boolean {
  if (dismissedInMemory) return true;
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dismiss() {
  dismissedInMemory = true;
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Sin almacenamiento: basta con el estado en memoria.
  }
  for (const l of listeners) l();
}

/**
 * Aviso del ambiente de pruebas (staging), sobre todas las pantallas autenticadas. En producción no se muestra.
 * Una sola línea: en pantallas angostas va el texto corto y la ayuda explica el resto. La X lo oculta.
 */
function StagingBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div
      role="note"
      aria-label="Ambiente de pruebas"
      style={{ height: STAGING_BANNER_HEIGHT }}
      className="relative flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-100 pr-14 pl-3 text-amber-950"
    >
      <FlaskConical className="size-5 shrink-0" aria-hidden />
      <p className="truncate text-sm font-medium">
        <span className="sm:hidden">Ambiente de pruebas</span>
        <span className="hidden sm:inline">{text}</span>
      </p>
      <HelpLink
        slug="ambiente-de-pruebas"
        label="¿Qué es el ambiente de pruebas?"
        className="shrink-0 text-amber-950 hover:bg-amber-200"
      />
      <Button
        variant="ghost"
        size="icon-lg"
        className="absolute top-0 right-1 size-11 text-amber-950 hover:bg-amber-200 hover:text-amber-950"
        onClick={onDismiss}
        aria-label="Ocultar el aviso de ambiente de pruebas"
        title="Ocultar el aviso"
      >
        <X className="size-5" aria-hidden />
      </Button>
    </div>
  );
}

/** Envuelve las pantallas autenticadas: muestra el aviso y publica su alto en `--app-banner-h` (0 si se cerró). */
export function StagingShell({ children }: { children: React.ReactNode }) {
  const text = capabilities.notices.banner;
  const dismissed = useSyncExternalStore(subscribe, isDismissed, () => false);
  if (!text) return <>{children}</>;
  return (
    <div style={{ '--app-banner-h': dismissed ? '0px' : STAGING_BANNER_HEIGHT } as React.CSSProperties}>
      {dismissed ? null : <StagingBanner text={text} onDismiss={dismiss} />}
      {children}
    </div>
  );
}
