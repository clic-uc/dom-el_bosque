'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Botón "Copiar" con confirmación visible. Si el navegador no permite copiar, lo dice y el texto queda seleccionable. */
export function CopyButton({ value, label = 'Copiar', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copiado al portapapeles');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('No se pudo copiar automáticamente. Selecciona el texto y cópialo con Ctrl+C.');
    }
  }

  return (
    <Button type="button" variant="outline" className={cn('h-11 text-base', className)} onClick={() => void copy()}>
      {copied ? <Check className="text-secondary-strong" aria-hidden /> : <Copy aria-hidden />}
      {copied ? 'Copiado' : label}
    </Button>
  );
}

/**
 * Muestra una contraseña temporal UNA sola vez, grande y legible, con botón para copiar y el recordatorio
 * de que el usuario deberá cambiarla al ingresar.
 */
export function PasswordReveal({ email, password }: { email: string; password: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-primary/30 bg-primary-soft p-4">
        <p className="text-sm font-medium text-primary-dark">Contraseña temporal para {email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <code
            className="rounded-md border bg-white px-3 py-2 font-mono text-xl tracking-wider break-all select-all"
            aria-label="Contraseña temporal"
          >
            {password}
          </code>
          <CopyButton value={password} label="Copiar contraseña" />
        </div>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-base text-foreground/80">
        <li>Entrégala al usuario por un medio seguro. No se volverá a mostrar: si la pierdes, deberás asignar otra.</li>
        <li>El usuario deberá cambiarla al ingresar.</li>
      </ul>
    </div>
  );
}
