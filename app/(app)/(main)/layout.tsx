import { redirect } from 'next/navigation';
import { getOptionalActor } from '@/server/auth/session';

/** Mientras el usuario tenga contraseña temporal, no accede a nada más que `/account/password` (§6.1). */
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const actor = await getOptionalActor();
  if (!actor) redirect('/');
  if (actor.mustChangePassword) redirect('/account/password');
  return <>{children}</>;
}
