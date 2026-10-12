import type { Metadata } from 'next';
import { Brand } from '@/components/shared/brand';
import { ForcedPasswordChange } from '@/features/auth/ForcedPasswordChange';
import { getActor } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Define tu contraseña' };

export default async function PasswordPage() {
  const actor = await getActor({ allowPasswordChangeRequired: true });
  return (
    <main className="flex min-h-app items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-lg rounded-2xl border bg-white p-8 shadow-sm">
        <Brand className="justify-center" />
        <h1 className="mt-6 text-2xl font-semibold text-primary-dark">Define tu contraseña</h1>
        <p className="mt-2 text-base text-muted-foreground">
          {actor.mustChangePassword
            ? 'Estás usando una contraseña temporal. Para continuar, elige una contraseña propia de al menos 10 caracteres.'
            : 'Elige una contraseña nueva de al menos 10 caracteres.'}
        </p>
        <ForcedPasswordChange forced={actor.mustChangePassword} />
      </div>
    </main>
  );
}
