'use client';

import { BookOpen, Menu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { helpSections, type HelpSectionId } from '@/shared/help-slugs';

/** Datos mínimos de una página para la navegación (serializables: se pasan de servidor a cliente). */
export type HelpNavItem = { slug: string; title: string; section: HelpSectionId; draft: boolean };

type Props = { pages: HelpNavItem[]; activeSlug: string | null };

/** Lista de secciones y páginas con la activa resaltada. Se usa en la barra lateral y en el panel móvil. */
function HelpNavList({ pages, activeSlug, onNavigate }: Props & { onNavigate?: () => void }) {
  return (
    <nav aria-label="Contenido del manual" className="space-y-6">
      <Link
        href="/help"
        onClick={onNavigate}
        aria-current={activeSlug === null ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-md px-3 text-base font-semibold',
          activeSlug === null ? 'bg-primary-soft text-primary-dark' : 'text-foreground hover:bg-muted',
        )}
      >
        <BookOpen className="size-5 text-primary" aria-hidden /> Índice del manual
      </Link>
      {helpSections.map((section) => {
        const items = pages.filter((p) => p.section === section.id);
        if (items.length === 0) return null;
        return (
          <div key={section.id}>
            <p className="mb-1 px-3 text-sm font-semibold text-foreground">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {items.map((p) => {
                const active = p.slug === activeSlug;
                return (
                  <li key={p.slug}>
                    <Link
                      href={`/help/${p.slug}`}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center rounded-md border-l-4 px-3 py-2 text-[15px] leading-snug',
                        active
                          ? 'border-primary bg-primary-soft font-semibold text-primary-dark'
                          : 'border-transparent text-foreground hover:bg-muted',
                      )}
                    >
                      {p.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Barra lateral fija (pantallas grandes). */
export function HelpSidebar(props: Props) {
  return (
    <aside className="sticky top-0 hidden h-app w-72 shrink-0 overflow-y-auto border-r bg-card px-3 py-6 lg:block">
      <HelpNavList {...props} />
    </aside>
  );
}

/** Botón que abre el contenido del manual en un panel lateral (pantallas chicas). */
export function HelpMobileNav(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="h-11 gap-2 px-3 text-base lg:hidden"
          aria-label="Abrir el contenido del manual"
        >
          <Menu className="size-5" aria-hidden /> Contenido
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 overflow-y-auto px-3 py-6 sm:max-w-sm">
        <SheetHeader className="p-0 px-3">
          <SheetTitle className="text-lg">Manual de uso</SheetTitle>
          <SheetDescription>Elige un tema para leerlo.</SheetDescription>
        </SheetHeader>
        <HelpNavList {...props} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
