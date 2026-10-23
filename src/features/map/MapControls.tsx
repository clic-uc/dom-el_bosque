'use client';

import { ChevronDown, Shapes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HelpLink } from '@/features/help/HelpLink';
import { polygonKindLabels, polygonKinds, polygonStyles, type PolygonKind } from '@/shared/constants';
import type { LayerWithCount } from '@/shared/types';
import { HeatmapPanel, type HeatSettings } from './HeatmapPanel';
import type { HeatMode } from './url-state';

type Props = {
  /** Capa de trabajo y superpuestas, en ese orden. */
  visibleLayers: LayerWithCount[];
  polys: PolygonKind[];
  heat: HeatMode | null;
  heatLayers: number[];
  heatSettings: HeatSettings;
  onTogglePoly: (kind: PolygonKind) => void;
  onChangeHeat: (heat: HeatMode | null, heatLayers?: number[]) => void;
  onChangeHeatSettings: (s: HeatSettings) => void;
};

function LimitsControl({ polys, onTogglePoly }: Pick<Props, 'polys' | 'onTogglePoly'>) {
  const active = polys.length > 0;
  const label =
    polys.length === 0
      ? 'Límites'
      : polys.length === 1
        ? `Límites: ${polygonKindLabels[polys[0]!].toLowerCase()}`
        : `Límites (${polys.length})`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'outline'}
          size="lg"
          className="h-11 gap-2 px-4 text-base shadow-md"
          aria-pressed={active}
        >
          <Shapes className="size-5 text-muted-foreground" aria-hidden />
          {label}
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="z-(--z-index-toolbar) w-80 max-w-[calc(100vw-2rem)] space-y-2 p-4"
      >
        <p className="flex items-center gap-1 text-base font-semibold">
          Límites en el mapa
          <HelpLink slug="mapa/poligonos" label="¿Qué son los límites?" />
        </p>
        <p className="text-sm text-muted-foreground">
          Dibuja la comuna, los sectores o las villas. Haz clic en uno para ver cuántos registros tiene.
        </p>
        <ul className="space-y-0.5">
          {polygonKinds.map((kind) => {
            const cid = `limits-${kind}`;
            return (
              <li key={kind} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted">
                <Checkbox
                  id={cid}
                  className="size-5"
                  checked={polys.includes(kind)}
                  onCheckedChange={() => onTogglePoly(kind)}
                />
                <Label
                  htmlFor={cid}
                  className="flex flex-1 cursor-pointer items-center gap-2 py-2 text-base font-normal"
                >
                  <span
                    className="inline-block size-3.5 rounded-sm border-2"
                    style={{
                      borderColor: polygonStyles[kind].line,
                      backgroundColor: `${polygonStyles[kind].line}22`,
                    }}
                    aria-hidden
                  />
                  {polygonKindLabels[kind]}
                </Label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Controles de cómo se ve el mapa (límites y mapa de calor), flotando sobre él; no aplican a la tabla. */
export function MapControls({
  visibleLayers,
  polys,
  heat,
  heatLayers,
  heatSettings,
  onTogglePoly,
  onChangeHeat,
  onChangeHeatSettings,
}: Props) {
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-(--z-index-map-controls) flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
      <div className="pointer-events-auto flex flex-wrap gap-2">
        <LimitsControl polys={polys} onTogglePoly={onTogglePoly} />
        <HeatmapPanel
          visibleLayers={visibleLayers}
          heat={heat}
          heatLayers={heatLayers}
          settings={heatSettings}
          onChangeHeat={onChangeHeat}
          onChangeSettings={onChangeHeatSettings}
        />
      </div>
      {heat ? (
        <div
          className="pointer-events-auto w-56 rounded-md border bg-background/95 px-3 py-2 shadow-md"
          aria-label="Leyenda del mapa de calor"
        >
          <p className="text-sm font-medium">
            {heat === 'density' ? 'Cantidad de registros' : 'Suma de valores'}
          </p>
          <div
            className="mt-1 h-3 rounded-full"
            style={{
              background:
                'linear-gradient(to right, rgba(33,102,172,0), #67a9cf, #a1dab4, #fecc5c, #fd8d3c, #e31a1c)',
            }}
            aria-hidden
          />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Menos</span>
            <span>Más</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
