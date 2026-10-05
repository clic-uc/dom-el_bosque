'use client';

import { Crosshair, Eye, Loader2, Pencil } from 'lucide-react';
import { useId, useState } from 'react';
import { LayerIcon } from '@/components/shared/layer-icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AttachmentsList } from '@/features/attachments/AttachmentsList';
import { useCan } from '@/features/auth/actor-context';
import { HelpLink } from '@/features/help/HelpLink';
import { errorMessage } from '@/lib/api';
import { formatInt } from '@/lib/format';
import { polygonKindLabels } from '@/shared/constants';
import { usePolygonDetail, useUpdatePolygon } from './hooks';
import { PanelSection, SidePanel } from './SidePanel';

type Props = {
  polygonId: number;
  workingLayerId: number | null;
  overlayLayerIds: number[];
  onClose: () => void;
  onOverlayLayer: (layerId: number) => void;
  onFit: (bbox: [number, number, number, number]) => void;
};

/** Panel del polígono de referencia (§10.2): nombre editable, conteos por capa y documentos. */
export function PolygonSidePanel({ polygonId, workingLayerId, overlayLayerIds, onClose, onOverlayLayer, onFit }: Props) {
  const can = useCan();
  const canEdit = can('layers.write');
  const id = useId();
  const detail = usePolygonDetail(polygonId);
  const update = useUpdatePolygon();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  if (detail.isPending) {
    return (
      <SidePanel title="Polígono" onClose={onClose}>
        <LoadingState rows={4} label="Cargando el polígono…" />
      </SidePanel>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <SidePanel title="Polígono" onClose={onClose}>
        <ErrorState title="No se pudo cargar el polígono" message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
      </SidePanel>
    );
  }
  const poly = detail.data;
  const kindLabel = poly.kind === 'sector' ? 'Sector' : poly.kind === 'villa' ? 'Villa / Población' : 'Comuna';
  const total = poly.counts.reduce((acc, c) => acc + c.count, 0);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await update.mutateAsync({ id: poly.id, name: trimmed });
    setEditing(false);
  }

  return (
    <SidePanel
      title={poly.name || `${kindLabel} sin nombre`}
      onClose={onClose}
      data-testid="polygon-panel"
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-md">
            {kindLabel}
          </Badge>
          {poly.sector?.name ? <span>Sector {poly.sector.name}</span> : null}
          <HelpLink slug="mapa/poligonos" label="¿Qué son los polígonos de referencia?" />
        </span>
      }
      headerExtra={
        poly.bbox ? (
          <Button variant="outline" size="icon-lg" className="size-11" onClick={() => onFit(poly.bbox!)} aria-label="Centrar el mapa en este polígono">
            <Crosshair className="size-5" aria-hidden />
          </Button>
        ) : null
      }
    >
      <div className="space-y-6">
        {canEdit ? (
          <PanelSection
            title="Nombre"
            action={
              !editing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setName(poly.name ?? '');
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden /> Editar
                </Button>
              ) : null
            }
          >
            {editing ? (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveName();
                }}
              >
                <Label htmlFor={`${id}-name`} className="text-base">
                  Nombre del {kindLabel.toLowerCase()}
                </Label>
                <Input id={`${id}-name`} className="h-11 text-base" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={200} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="lg" onClick={() => setEditing(false)} disabled={update.isPending}>
                    Cancelar
                  </Button>
                  <Button type="submit" size="lg" disabled={update.isPending || !name.trim()}>
                    {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null} Guardar nombre
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-base">{poly.name || <span className="text-muted-foreground">Sin nombre</span>}</p>
            )}
          </PanelSection>
        ) : null}

        <PanelSection title={`Registros en este polígono (${formatInt(total)})`}>
          {poly.counts.length === 0 ? (
            <EmptyState title="Sin registros" description="Ninguna capa tiene registros ubicados dentro de este polígono." className="py-6" />
          ) : (
            <ul className="divide-y rounded-md border">
              {poly.counts.map((c) => {
                const isWorking = c.layerId === workingLayerId;
                const isOverlay = overlayLayerIds.includes(c.layerId);
                return (
                  <li key={c.layerId} className="flex items-center gap-3 px-3 py-2">
                    <LayerIcon name={c.icon} color={c.iconColor} className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-base">{c.layerName}</span>
                    <span className="text-base font-semibold tabular-nums">{formatInt(c.count)}</span>
                    {isWorking ? (
                      <Badge variant="outline" className="rounded-md">
                        Capa de trabajo
                      </Badge>
                    ) : (
                      <Button
                        variant={isOverlay ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-9"
                        onClick={() => onOverlayLayer(c.layerId)}
                        aria-pressed={isOverlay}
                        aria-label={isOverlay ? `Dejar de mostrar ${c.layerName}` : `Mostrar ${c.layerName} en el mapa`}
                      >
                        <Eye aria-hidden /> {isOverlay ? 'Visible' : 'Mostrar'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </PanelSection>

        <PanelSection title="Documentos">
          <AttachmentsList entityType="polygon" entityId={String(poly.id)} canEdit={can('attachments.write')} />
        </PanelSection>

        <p className="text-xs text-muted-foreground">
          {polygonKindLabels[poly.kind]} · Polígono #{poly.id}
          {poly.code ? ` · código ${poly.code}` : ''}
        </p>
      </div>
    </SidePanel>
  );
}
