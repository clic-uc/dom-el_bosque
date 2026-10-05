import { redirect } from 'next/navigation';
import { Providers } from '@/app/providers';
import { ActorProvider } from '@/features/auth/actor-context';
import { getOptionalActor } from '@/server/auth/session';
import type { CurrentUser } from '@/shared/types';

/** Shell autenticado (§10.4): valida la sesión en servidor. El cambio obligatorio de contraseña se exige en `(main)`. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getOptionalActor();
  if (!actor) redirect('/');

  const current: CurrentUser = {
    id: actor.userId,
    name: actor.name,
    email: actor.email,
    role: actor.rawRole,
    mustChangePassword: actor.mustChangePassword,
  };

  return (
    <Providers>
      <ActorProvider actor={current}>{children}</ActorProvider>
    </Providers>
  );
}
