import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/features/auth/SignInForm';
import { getOptionalActor } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Ingreso' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const actor = await getOptionalActor();
  if (actor) redirect(actor.mustChangePassword ? '/account/password' : '/map');
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-xl rounded-2xl border bg-white p-8 shadow-sm sm:p-10">
        <div className="flex flex-col items-center text-center">
          <Image src="/logo_el_bosque.png" alt="Municipalidad de El Bosque" width={96} height={96} priority />
          <p className="mt-4 text-sm font-semibold tracking-wide text-secondary-strong uppercase">DOM El Bosque</p>
          <h1 className="mt-1 text-2xl font-semibold text-primary-dark sm:text-3xl">
            Ingreso a plataforma georreferenciada
          </h1>
        </div>
        <SignInForm next={typeof next === 'string' ? next : undefined} />
        <div className="mt-8 space-y-2 border-t pt-6 text-center text-sm text-muted-foreground">
          <p>¿No tienes cuenta? Solicítala a un administrador de la DOM.</p>
          <p>¿Olvidaste tu contraseña? Pide a un administrador que te asigne una temporal.</p>
        </div>
      </div>
    </main>
  );
}
