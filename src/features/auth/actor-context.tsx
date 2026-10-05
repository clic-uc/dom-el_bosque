'use client';

import { createContext, useContext } from 'react';
import { can, type AppAction, type Role } from '@/shared/permissions';
import type { CurrentUser } from '@/shared/types';

const ActorContext = createContext<CurrentUser | null>(null);

/** El usuario actual, validado en el servidor por `app/(app)/layout.tsx`. */
export function ActorProvider({ actor, children }: { actor: CurrentUser; children: React.ReactNode }) {
  return <ActorContext.Provider value={actor}>{children}</ActorContext.Provider>;
}

export function useActor(): CurrentUser {
  const actor = useContext(ActorContext);
  if (!actor) throw new Error('useActor debe usarse dentro de ActorProvider');
  return actor;
}

/** Rol efectivo (`null` = "Sin rol", se comporta como visor). La autorización real siempre es en el servidor. */
export function useCurrentRole(): Role | null {
  return useActor().role;
}

export function useCan(): (action: AppAction) => boolean {
  const role = useCurrentRole();
  return (action) => can(role, action);
}
