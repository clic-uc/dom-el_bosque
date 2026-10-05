import { ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { getActor } from '@/server/auth/session';
import { AdminShell } from '@/features/admin/AdminShell';

/** Guard admin (§10.3): otros roles ven "Sin acceso" con link "Volver al mapa". */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (actor.role !== 'admin') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl border bg-white p-8 text-center shadow-sm">
          <ShieldOff className="mx-auto size-12 text-muted-foreground" aria-hidden />
          <h1 className="mt-4 text-2xl font-semibold text-primary-dark">Sin acceso</h1>
          <p className="mt-2 text-base text-muted-foreground">
            El panel de administración es solo para administradores.
          </p>
          <Link
            href="/map"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-white hover:bg-primary-light"
          >
            Volver al mapa
          </Link>
        </div>
      </main>
    );
  }
  return <AdminShell>{children}</AdminShell>;
}
