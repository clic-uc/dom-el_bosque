'use client';

import { ArrowRight } from 'lucide-react';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { HelpLink } from '@/features/help/HelpLink';
import { formatCoord } from '@/lib/format';
import { useUpdateCoordinates } from './hooks';

export type CoordinateChangeRequest = {
  recordId: number;
  layerId: number;
  roleId: string | null;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
};

type Props = {
  request: CoordinateChangeRequest | null;
  /** Cancelar o cerrar: el mapa devuelve el marcador a su posición. */
  onCancel: () => void;
  onDone: () => void;
};

/** "Confirmar cambio de coordenadas" tras arrastrar un marcador (§10.2, §8.3). */
export function CoordinateUpdateDialog(props: Props) {
  // Cada solicitud nueva monta un diálogo limpio (la casilla vuelve a "solo este registro").
  const key = props.request
    ? `${props.request.recordId}:${props.request.to.lat}:${props.request.to.lon}`
    : 'none';
  return <CoordinateUpdateDialogInner key={key} {...props} />;
}

function CoordinateUpdateDialogInner({ request, onCancel, onDone }: Props) {
  const id = useId();
  const [scopeRole, setScopeRole] = useState(false);
  const mutation = useUpdateCoordinates();

  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title="Confirmar cambio de coordenadas"
      confirmLabel="Confirmar cambio"
      pending={mutation.isPending}
      onConfirm={async () => {
        if (!request) return;
        await mutation.mutateAsync({
          id: request.recordId,
          layerId: request.layerId,
          input: {
            lat: request.to.lat,
            lon: request.to.lon,
            scope: scopeRole && request.roleId ? 'role' : 'record',
          },
        });
        onDone();
      }}
      description={
        request ? (
          <div className="space-y-3">
            {request.roleId ? (
              <p>
                Rol <span className="font-mono">{request.roleId}</span>
              </p>
            ) : (
              <p>Registro sin rol</p>
            )}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md bg-muted p-3 font-mono text-sm">
              <div>
                <p className="text-xs font-sans text-muted-foreground">Antes</p>
                <p>{formatCoord(request.from.lat)}</p>
                <p>{formatCoord(request.from.lon)}</p>
              </div>
              <ArrowRight className="size-5 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-xs font-sans text-muted-foreground">Ahora</p>
                <p>{formatCoord(request.to.lat)}</p>
                <p>{formatCoord(request.to.lon)}</p>
              </div>
            </div>
            {request.roleId ? (
              <div className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  id={`${id}-scope`}
                  className="mt-1 size-5"
                  checked={scopeRole}
                  onCheckedChange={(c) => setScopeRole(c === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor={`${id}-scope`} className="text-base leading-snug">
                    Actualizar todos los registros con el mismo rol
                    <HelpLink
                      slug="registros/coordenadas"
                      label="¿Qué significa actualizar todos los registros del rol?"
                    />
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {scopeRole
                      ? `Se moverá la ubicación de referencia del rol ${request.roleId} y la de todos sus registros que no tengan coordenadas propias.`
                      : 'Solo se moverá este registro; quedará con coordenadas propias y no seguirá al rol.'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">El registro quedará con coordenadas propias.</p>
            )}
          </div>
        ) : null
      }
    />
  );
}
