'use client';

/**
 * CONTRATO (fase 7): asistente de importación en 4 pasos (§10.2 "ImportWizard").
 * Este archivo es un stub; la implementación real lo reemplaza manteniendo estas props.
 */
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

export function ImportWizard(_props: ImportWizardProps) {
  return null;
}
