import Link from 'next/link';
import { MapPinOff } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border bg-white p-8 text-center shadow-sm">
        <MapPinOff className="mx-auto size-12 text-primary" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold text-primary-dark">Página no encontrada</h1>
        <p className="mt-2 text-base text-muted-foreground">
          La dirección que abriste no existe o fue movida.
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
