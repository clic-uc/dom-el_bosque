import { FlaskConical } from 'lucide-react';
import { HelpLink } from '@/features/help/HelpLink';
import { capabilities } from '@/shared/capabilities';

/** Alto fijo del aviso; las vistas de pantalla completa lo descuentan con `h-app` / `min-h-app`. */
export const STAGING_BANNER_HEIGHT = '2.75rem';

/**
 * Aviso permanente del ambiente de pruebas (staging), sobre todas las pantallas autenticadas.
 * En producción no se muestra. Una sola línea: en pantallas angostas va el texto corto y la ayuda explica el resto.
 */
export function StagingBanner() {
  const text = capabilities.notices.banner;
  if (!text) return null;
  return (
    <div
      role="note"
      aria-label="Ambiente de pruebas"
      style={{ height: STAGING_BANNER_HEIGHT }}
      className="flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-100 px-3 text-amber-950"
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
    </div>
  );
}
