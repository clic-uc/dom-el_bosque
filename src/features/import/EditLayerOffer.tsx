'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LayerFormDialog } from '@/features/layers/LayerFormDialog';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { LayerWithCount } from '@/shared/types';

type Props = {
  layerId: number;
  /** La capa se guardó: el asistente vuelve a leerla para que el mapeo use el cambio. */
  onChanged: () => void;
};

/**
 * Salida para quien intenta importar sin Rol SII a una capa que lo exige: si la capa se creó con Rol por error,
 * se puede corregir aquí mismo sin perder el archivo ya subido. Quien puede importar (editor, admin) también puede
 * editar capas, por eso no se comprueba el permiso aquí.
 */
export function EditLayerOffer({ layerId, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  // Las capas solo se piden cuando la persona decide editar.
  const layers = useQuery({
    queryKey: queryKeys.layers.list(),
    queryFn: () => api<LayerWithCount[]>('/api/layers'),
    staleTime: 60_000,
    enabled: open,
  });
  const layer = open ? layers.data?.find((l) => l.id === layerId) : undefined;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-destructive/20 pt-3">
      <p className="max-w-xl text-sm">
        ¿Esta capa no debería usar Rol SII? Si se creó así por error, edítala y desactiva «Esta capa incluye Rol
        SII». Tu archivo se mantiene.
      </p>
      <Button
        type="button"
        variant="outline"
        className="h-11 shrink-0 text-base"
        onClick={() => setOpen(true)}
        disabled={open && !layer}
      >
        {open && !layer ? <Loader2 className="animate-spin" aria-hidden /> : <Pencil aria-hidden />}
        Editar la capa
      </Button>
      {layer ? (
        <LayerFormDialog
          open
          onOpenChange={(o) => !o && setOpen(false)}
          mode="edit"
          layer={layer}
          onSaved={onChanged}
        />
      ) : null}
    </div>
  );
}
