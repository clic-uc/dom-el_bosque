'use client';

import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/shared/states';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ImportSource, ImportStatusFull } from '@/shared/types';
import { useImportStatus } from './hooks';
import { STEPS } from './labels';
import { MappingStep, type MappingOptions } from './MappingStep';
import { ResultStep } from './ResultStep';
import { ReviewStep } from './ReviewStep';
import { UploadStep } from './UploadStep';

export type ImportWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Capa destino (por defecto la capa de trabajo). */
  layerId: number;
  /** Retomar un borrador existente. */
  importId?: string;
  /** Se llama al confirmar o revertir una importación, para invalidar features/records/filters. */
  onCompleted?: (layerId: number) => void;
};

type Step = 1 | 2 | 3 | 4;

function StepIndicator({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Pasos">
      {STEPS.map((s) => (
        <li key={s.n} className="flex items-center gap-2" aria-current={s.n === step ? 'step' : undefined}>
          <span
            className={cn(
              'flex size-7 items-center justify-center rounded-full border text-sm font-semibold',
              s.n === step
                ? 'border-primary bg-primary text-white'
                : s.n < step
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground',
            )}
          >
            {s.n}
          </span>
          <span className={cn(s.n === step ? 'font-medium' : 'text-muted-foreground')}>{s.label}</span>
          {s.n < STEPS.length ? <span className="mx-1 h-px w-6 bg-border" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

/** Paso efectivo: el elegido por el usuario, ajustado por el estado real de la importación (sin efectos). */
function resolveStep(step: Step, status: ImportStatusFull | undefined, analyzedHere: boolean): Step {
  if (!status || step !== 3) return step;
  if (status.status === 'COMPLETED' || (status.status === 'FAILED' && status.committedAt)) return 4;
  if (status.status === 'UPLOADED' && !analyzedHere) return 2;
  return 3;
}

type BodyProps = Omit<ImportWizardProps, 'open'>;

/** Estado del asistente. Vive dentro del `DialogContent`, así se reinicia solo al cerrar y abrir. */
function WizardBody({ layerId, importId, onOpenChange, onCompleted }: BodyProps) {
  const [step, setStep] = useState<Step>(importId ? 3 : 1);
  const [uploaded, setUploaded] = useState<ImportSource | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(importId ?? null);
  const [options, setOptions] = useState<MappingOptions | undefined>(undefined);

  // Al retomar un borrador necesitamos la vista previa del archivo; después solo el estado.
  const needsSource = !!currentId && !uploaded && step !== 4;
  const statusQuery = useImportStatus(currentId, { withSource: needsSource });
  const status = statusQuery.data;
  const source = uploaded ?? status?.source ?? null;
  const effectiveStep = resolveStep(step, status, options !== undefined);

  const title = source?.layer.name ?? status?.layerName ?? status?.layer.name;
  const current = STEPS[effectiveStep - 1]!;

  return (
    <>
      <DialogHeader className="gap-1">
        <DialogTitle className="text-xl">Importar registros{title ? ` a ${title}` : ''}</DialogTitle>
        <DialogDescription className="text-base">
          Paso {effectiveStep} de {STEPS.length} · {current.label}
        </DialogDescription>
        <StepIndicator step={effectiveStep} />
      </DialogHeader>

      <div className="min-h-0 flex-1">
        {effectiveStep === 1 ? (
          <UploadStep
            layerId={layerId}
            source={source}
            onSource={(s) => {
              setUploaded(s);
              setCurrentId(s.importId);
              setOptions(undefined);
            }}
            onNext={() => setStep(2)}
          />
        ) : null}

        {effectiveStep === 2 ? (
          source ? (
            <MappingStep
              source={source}
              initial={options}
              onBack={() => setStep(1)}
              onAnalyzing={(o) => {
                setOptions(o);
                setStep(3);
              }}
            />
          ) : statusQuery.error ? (
            <ErrorState
              message={errorMessage(statusQuery.error)}
              onRetry={() => void statusQuery.refetch()}
            />
          ) : (
            <LoadingState label="Cargando la vista previa del archivo…" />
          )
        ) : null}

        {effectiveStep === 3 ? (
          status ? (
            <ReviewStep status={status} onDiscarded={() => onOpenChange(false)} />
          ) : statusQuery.error ? (
            <ErrorState
              message={errorMessage(statusQuery.error)}
              onRetry={() => void statusQuery.refetch()}
            />
          ) : (
            <LoadingState label="Cargando el estado de la importación…" />
          )
        ) : null}

        {effectiveStep === 4 && status ? (
          <ResultStep status={status} onClose={() => onOpenChange(false)} onCompleted={onCompleted} />
        ) : null}
      </div>
    </>
  );
}

/**
 * Asistente de importación en 4 pasos (§10.2 "ImportWizard"): Archivo → Columnas → Revisión → Resultado.
 * Se puede cerrar y retomar un borrador con `importId` (desde el historial de la capa).
 */
export function ImportWizard({ open, onOpenChange, layerId, importId, onCompleted }: ImportWizardProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[92vh] max-w-6xl flex-col gap-3 sm:max-w-6xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <WizardBody
          key={importId ?? 'new'}
          layerId={layerId}
          importId={importId}
          onOpenChange={onOpenChange}
          onCompleted={onCompleted}
        />
      </DialogContent>
    </Dialog>
  );
}
