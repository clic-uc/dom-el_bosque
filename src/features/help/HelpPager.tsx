import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type HelpPagerLink = { slug: string; title: string };

/** Navegación "Anterior / Siguiente" al pie de cada página del manual (§10.7). */
export function HelpPager({ prev, next }: { prev: HelpPagerLink | null; next: HelpPagerLink | null }) {
  return (
    <nav
      aria-label="Página anterior y siguiente"
      className="mx-auto mt-6 w-full max-w-3xl px-4 pb-12 sm:px-6"
    >
      <div className="grid gap-3 border-t pt-6 sm:grid-cols-2">
        {prev ? (
          <PagerLink slug={prev.slug} title={prev.title} direction="prev" />
        ) : (
          <span aria-hidden className="hidden sm:block" />
        )}
        {next ? <PagerLink slug={next.slug} title={next.title} direction="next" /> : null}
      </div>
    </nav>
  );
}

function PagerLink({ slug, title, direction }: HelpPagerLink & { direction: 'prev' | 'next' }) {
  const isNext = direction === 'next';
  return (
    <Link
      href={`/help/${slug}`}
      className={cn(
        'flex min-h-20 flex-col justify-center gap-1 rounded-lg border bg-card px-5 py-4 hover:border-primary hover:bg-primary-soft',
        isNext ? 'items-end text-right' : 'items-start text-left',
      )}
    >
      <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
        {isNext ? null : <ArrowLeft className="size-4" aria-hidden />}
        {isNext ? 'Siguiente' : 'Anterior'}
        {isNext ? <ArrowRight className="size-4" aria-hidden /> : null}
      </span>
      <span className="text-lg font-semibold text-primary-dark">{title}</span>
    </Link>
  );
}
