'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border bg-white p-8 text-center shadow-sm">
        <TriangleAlert className="mx-auto size-12 text-destructive" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold text-primary-dark">Algo salió mal</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Ocurrió un problema inesperado. Puedes intentar de nuevo; si el problema continúa, avisa a un
          administrador.
        </p>
        {error.digest ? <p className="mt-2 text-xs text-muted-foreground">Código: {error.digest}</p> : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-white hover:bg-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Intentar de nuevo
        </button>
      </div>
    </main>
  );
}
