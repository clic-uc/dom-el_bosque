import { cn } from '@/lib/utils';

/** Contenedor de lectura del manual: ancho cómodo para leer, tipografía grande (§10.7). */
export function HelpArticle({
  title,
  eyebrow,
  children,
  className,
}: {
  title: string;
  /** Texto pequeño sobre el título (nombre de la sección). */
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={cn('mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10', className)}>
      <header className="mb-6 border-b pb-6">
        {eyebrow ? (
          <p className="mb-2 text-base font-medium text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl leading-tight font-semibold text-primary-dark sm:text-4xl">{title}</h1>
      </header>
      <div className="text-[17px] leading-8">{children}</div>
    </article>
  );
}
