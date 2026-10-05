import { PencilRuler } from 'lucide-react';

/**
 * Aviso de página en preparación (§10.7). Se incluye desde cada MDX con `draft: true`.
 * Tono amable: explica que el contenido viene y a quién acudir mientras tanto.
 */
export function DraftBanner() {
  return (
    <aside
      role="note"
      aria-label="Sección en preparación"
      className="my-6 flex gap-4 rounded-lg border border-primary/20 bg-primary-soft px-5 py-4"
    >
      <PencilRuler className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
      <div className="space-y-1">
        <p className="text-lg font-semibold text-primary-dark">Esta sección está en preparación</p>
        <p className="text-[17px] leading-8 text-foreground">
          Estamos escribiendo el contenido completo de esta página. Mientras tanto, si tienes dudas pregunta a
          un administrador de la DOM.
        </p>
      </div>
    </aside>
  );
}
