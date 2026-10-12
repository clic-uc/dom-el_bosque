import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Brand } from '@/components/shared/brand';
import { UserMenu } from '@/features/auth/UserMenu';
import { HelpMobileNav, HelpSidebar, type HelpNavItem } from './HelpNav';

/**
 * Marco del manual (§10.7): cabecera con marca, "Volver al mapa" y menú de usuario; navegación lateral por
 * secciones (en pantallas chicas, un panel desplegable).
 */
export function HelpLayout({
  pages,
  activeSlug,
  children,
}: {
  pages: HelpNavItem[];
  activeSlug: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-app bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <HelpMobileNav pages={pages} activeSlug={activeSlug} />
            <Link href="/help" className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2">
              <Brand />
            </Link>
            <span className="hidden text-lg font-semibold text-muted-foreground sm:inline" aria-hidden>
              / Manual de uso
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/map"
              className="inline-flex h-11 items-center gap-2 rounded-md border px-4 text-base font-medium hover:bg-slate-50"
            >
              <ArrowLeft className="size-4" aria-hidden />
              <span className="hidden sm:inline">Volver al mapa</span>
              <span className="sm:hidden">Mapa</span>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl">
        <HelpSidebar pages={pages} activeSlug={activeSlug} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
