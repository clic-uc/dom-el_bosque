'use client';

import { PencilRuler, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { helpSections } from '@/shared/help-slugs';
import { normalizeText } from '@/shared/text';
import type { HelpNavItem } from './HelpNav';

/** Índice del manual agrupado por sección, con buscador por título que filtra mientras escribes (§10.7). */
export function HelpIndex({ pages }: { pages: HelpNavItem[] }) {
  const [query, setQuery] = useState('');
  const q = normalizeText(query);

  const groups = useMemo(
    () =>
      helpSections
        .map((section) => ({
          ...section,
          items: pages.filter(
            (p) => p.section === section.id && (q === '' || normalizeText(p.title).includes(q)),
          ),
        }))
        .filter((g) => g.items.length > 0),
    [pages, q],
  );

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-8">
        <p className="mb-2 text-base font-medium text-muted-foreground">
          Georreferenciación DOM
        </p>
        <h1 className="text-3xl leading-tight font-semibold text-primary-dark sm:text-4xl">Manual de uso</h1>
        <p className="mt-3 text-[17px] leading-8 text-foreground">
          Aquí encuentras explicaciones paso a paso de cada parte de la plataforma. Si recién empiezas, lee{' '}
          <Link href="/help/primeros-pasos" className="font-medium text-primary underline underline-offset-4">
            Primeros pasos
          </Link>
          . Las páginas marcadas con <PencilRuler className="inline size-4 text-primary" aria-hidden />
          <span className="sr-only">el ícono de lápiz</span> todavía están en preparación.
        </p>
      </header>

      <div className="mb-8">
        <Label htmlFor="help-search" className="mb-2 block text-base font-medium">
          Buscar un tema
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="help-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Por ejemplo: campos únicos, importar, contraseña"
            className="h-12 bg-white pl-10 text-base md:text-base"
            autoComplete="off"
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
          {q === ''
            ? `${pages.length} temas en ${groups.length} secciones.`
            : `${total} resultado${total === 1 ? '' : 's'}.`}
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border bg-card px-6 py-10 text-center">
          <p className="text-lg font-medium">Sin resultados para “{query.trim()}”</p>
          <p className="mt-2 text-base text-muted-foreground">
            Prueba con otra palabra, por ejemplo el nombre de la pantalla o del botón que estás usando.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.id} aria-labelledby={`help-section-${g.id}`}>
              <h2 id={`help-section-${g.id}`} className="mb-3 text-xl font-semibold text-primary-dark">
                {g.title}
              </h2>
              <ul className="overflow-hidden rounded-lg border bg-card">
                {g.items.map((p) => (
                  <li key={p.slug} className="border-b last:border-b-0">
                    <Link
                      href={`/help/${p.slug}`}
                      className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 text-[17px] font-medium text-foreground hover:bg-primary-soft hover:text-primary-dark"
                    >
                      <span>{p.title}</span>
                      {p.draft ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
                          <PencilRuler className="size-3.5" aria-hidden /> En preparación
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
