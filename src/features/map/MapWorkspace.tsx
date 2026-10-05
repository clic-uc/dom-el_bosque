'use client';

import { Brand } from '@/components/shared/brand';
import { UserMenu } from '@/features/auth/UserMenu';

/**
 * Placeholder de la fase 2: el espacio de trabajo real (sidebar, toolbar, mapa, paneles) se implementa en la fase 4.
 */
export function MapWorkspace() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 items-center justify-between border-b bg-white px-4">
        <Brand size="sm" />
        <UserMenu />
      </header>
      <main className="flex flex-1 items-center justify-center bg-slate-50 text-muted-foreground">
        El mapa se está preparando.
      </main>
    </div>
  );
}
