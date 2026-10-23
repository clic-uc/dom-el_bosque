'use client';

import { Download } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { HelpLink } from '@/features/help/HelpLink';
import type { ImportStatusFull } from '@/shared/types';

type Props = {
  status: ImportStatusFull;
  onClose: () => void;
  onCompleted?: (layerId: number) => void;
};

const fmt = (n: number) => n.toLocaleString('es-CL');

/** Paso 4 — Resultado (§10.2): tarjetas con conteos, próximo correlativo y descarga de filas con errores. */
export function ResultStep({ status, onClose, onCompleted }: Props) {
  const completed = status.status === 'COMPLETED';
  useEffect(() => {
    if (completed) onCompleted?.(status.layerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, status.id]);

  const cards: { label: string; value: number; tone: string }[] = [
    {
      label: 'Creados',
      value: status.createdCount,
      tone: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    },
    { label: 'Actualizados', value: status.updatedCount, tone: 'border-sky-300 bg-sky-50 text-sky-900' },
    { label: 'Omitidos', value: status.skippedCount, tone: 'border-slate-300 bg-slate-50 text-slate-900' },
    { label: 'Fallidos', value: status.failedCount, tone: 'border-red-300 bg-red-50 text-red-900' },
  ];
  if (status.fullReplace || status.deletedCount > 0) {
    cards.push({
      label: 'Eliminados',
      value: status.deletedCount,
      tone: 'border-amber-300 bg-amber-50 text-amber-900',
    });
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {completed ? 'Importación completada' : 'La importación no se pudo completar'}
          </h3>
          <p className="text-base text-muted-foreground">
            {completed
              ? `Los registros ya están en la capa ${status.layerName ?? ''}. Puedes revertir esta importación desde el historial de la capa.`
              : (status.errorMessage ??
                'Ocurrió un error al guardar. Intenta de nuevo; si el problema sigue, avisa al administrador.')}
          </p>
          {completed && status.errorMessage ? (
            <p role="alert" className="mt-1 text-base text-amber-800">
              {status.errorMessage}
            </p>
          ) : null}
        </div>
        <HelpLink slug="importacion/revertir" label="Historial y cómo revertir" withText />
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-lg border px-4 py-3 ${c.tone}`}>
            <dt className="text-base font-medium">{c.label}</dt>
            <dd className="text-3xl font-semibold tabular-nums">{fmt(c.value)}</dd>
          </div>
        ))}
      </dl>

      {status.nextNumber ? (
        <p className="text-base">
          Próximo {status.nextNumber.label} que entregará la plataforma:{' '}
          <strong className="tabular-nums">{fmt(status.nextNumber.next)}</strong>
        </p>
      ) : null}

      {status.failedCount > 0 ? (
        <div className="rounded-md border px-4 py-3">
          <p className="text-base">
            {fmt(status.failedCount)}{' '}
            {status.failedCount === 1 ? 'fila no se importó' : 'filas no se importaron'} por errores. Descarga
            esas filas, corrígelas en Excel y súbelas en una nueva importación.
          </p>
          <Button asChild variant="outline" size="lg" className="mt-2 h-11 text-base">
            <a href={`/api/imports/${status.id}/errors`} download>
              <Download aria-hidden /> Descargar filas con errores ({fmt(status.failedCount)})
            </a>
          </Button>
        </div>
      ) : null}

      <div className="mt-auto flex justify-end border-t pt-4">
        <Button type="button" size="lg" className="h-11 text-base" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}
