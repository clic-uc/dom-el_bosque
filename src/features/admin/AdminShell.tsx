'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserMenu } from '@/features/auth/UserMenu';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/admin/users', label: 'Gestión de usuarios' },
  { href: '/admin/audit', label: 'Auditoría' },
];

/** Cabecera y pestañas del panel de administración (§10.3). */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-app bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-secondary-strong uppercase">Municipalidad de El Bosque</p>
            <h1 className="text-2xl font-semibold text-primary-dark">Panel de administración</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/map"
              className="inline-flex h-11 items-center gap-2 rounded-md border px-4 text-base font-medium hover:bg-slate-50"
            >
              <ArrowLeft className="size-4" aria-hidden /> Volver al mapa
            </Link>
            <UserMenu />
          </div>
        </div>
        <nav className="mx-auto max-w-6xl px-4" aria-label="Secciones de administración">
          <ul className="flex gap-2">
            {tabs.map((t) => {
              const active = pathname.startsWith(t.href);
              return (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-12 items-center border-b-2 px-4 text-base font-medium',
                      active ? 'border-primary text-primary-dark' : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
