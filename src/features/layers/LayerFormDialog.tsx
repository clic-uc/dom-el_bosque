'use client';

import type { Department } from '@/shared/constants';
import type { Layer, LayerWithCount } from '@/shared/types';

/**
 * CONTRATO (fase 3): diálogo de crear/editar capa (§10.2 "LayerFormDialog").
 * Este archivo es un stub; la implementación real lo reemplaza manteniendo estas props.
 */
export type LayerFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Requerido en modo `edit`. */
  layer?: LayerWithCount;
  /** Departamento preseleccionado en modo `create`. */
  defaultDepartment?: Department;
  onSaved?: (layer: Layer) => void;
  onDeleted?: (layerId: number) => void;
  /** "Importar registros" dentro del diálogo: el contenedor abre el ImportWizard. */
  onImport?: (layerId: number) => void;
};

export function LayerFormDialog(_props: LayerFormDialogProps) {
  return null;
}
