'use client';

import { ChevronDown, Flame } from 'lucide-react';
import { useId } from 'react';
import { LayerIcon } from '@/components/shared/layer-icon';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { HelpLink } from '@/features/help/HelpLink';
import { cn } from '@/lib/utils';
import type { LayerWithCount } from '@/shared/types';
import type { HeatMode } from './url-state';

export type HeatSettings = { radius: number; intensity: number; showPoints: boolean };
export const DEFAULT_HEAT_SETTINGS: HeatSettings = { radius: 30, intensity: 1, showPoints: false };

type Props = {
  /** Capa de trabajo y superpuestas, en ese orden. */
  visibleLayers: LayerWithCount[];
  heat: HeatMode | null;
  heatLayers: number[];
  settings: HeatSettings;
  onChangeHeat: (heat: HeatMode | null, heatLayers?: number[]) => void;
  onChangeSettings: (s: HeatSettings) => void;
  className?: string;
};

function fieldLabel(layer: LayerWithCount): string | null {
  if (!layer.heatmapFieldKey) return null;
  return layer.fields.find((f) => f.key === layer.heatmapFieldKey)?.label ?? layer.heatmapFieldKey;
}

/** Botón flotante "Mapa de calor" sobre el mapa, con su popover de ajustes (§10.2). */
export function HeatmapPanel({ visibleLayers, heat, heatLayers, settings, onChangeHeat, onChangeSettings, className }: Props) {
  const id = useId();
  const active = heat !== null;
  const mode: HeatMode = heat ?? 'density';
  // Sin selección explícita en la URL, se incluyen todas las capas visibles (o las que tengan valor, en modo Valor).
  const eligible = visibleLayers.filter((l) => mode === 'density' || !!l.heatmapFieldKey);
  const selected = heatLayers.length ? eligible.filter((l) => heatLayers.includes(l.id)).map((l) => l.id) : eligible.map((l) => l.id);
  const valueLayersCount = selected.filter((lid) => visibleLayers.find((l) => l.id === lid)?.heatmapFieldKey).length;

  function toggleLayer(layerId: number) {
    const next = selected.includes(layerId) ? selected.filter((x) => x !== layerId) : [...selected, layerId];
    onChangeHeat(mode, next);
  }

  function setMode(next: HeatMode) {
    const keep = visibleLayers.filter((l) => (next === 'density' || !!l.heatmapFieldKey) && selected.includes(l.id)).map((l) => l.id);
    onChangeHeat(next, keep);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={active ? 'secondary' : 'outline'} size="lg" className={cn('h-11 gap-2 px-4 text-base shadow-md', className)} aria-pressed={active}>
          <Flame className={cn('size-5', active ? 'text-orange-600' : 'text-muted-foreground')} aria-hidden />
          {active ? `Mapa de calor: ${mode === 'density' ? 'densidad' : 'valor'}` : 'Mapa de calor'}
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="z-(--z-index-toolbar) max-h-[70dvh] w-96 max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${id}-toggle`} className="text-base font-semibold">
            Mapa de calor
            <HelpLink slug="mapa/mapas-de-calor" label="¿Cómo se lee el mapa de calor?" />
          </Label>
          <Switch id={`${id}-toggle`} className="h-6 w-11 [&_[data-slot=switch-thumb]]:size-5" checked={active} onCheckedChange={(c) => onChangeHeat(c ? mode : null, c ? selected : [])} />
        </div>

        <fieldset disabled={!active} className="space-y-2 disabled:opacity-60">
          <legend className="text-sm font-medium">Modo</legend>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as HeatMode)} className="gap-2">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft">
              <RadioGroupItem value="density" className="mt-1 size-5" />
              <span>
                <span className="block text-base font-medium">Densidad</span>
                <span className="block text-sm text-muted-foreground">Dónde hay más registros.</span>
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft">
              <RadioGroupItem value="value" className="mt-1 size-5" />
              <span>
                <span className="block text-base font-medium">Valor</span>
                <span className="block text-sm text-muted-foreground">Suma de un valor numérico de cada capa (por ejemplo, montos).</span>
              </span>
            </label>
          </RadioGroup>
        </fieldset>

        <fieldset disabled={!active} className="space-y-2 disabled:opacity-60">
          <legend className="text-sm font-medium">Capas incluidas</legend>
          {visibleLayers.length === 0 ? <p className="text-sm text-muted-foreground">Elige una capa de trabajo para ver el mapa de calor.</p> : null}
          <ul className="space-y-1">
            {visibleLayers.map((l) => {
              const label = fieldLabel(l);
              const disabled = mode === 'value' && !label;
              const checked = selected.includes(l.id);
              return (
                <li key={l.id} className="flex items-start gap-3 rounded-md px-1 py-1.5">
                  <Checkbox id={`${id}-l-${l.id}`} className="mt-1 size-5" checked={checked && !disabled} disabled={disabled} onCheckedChange={() => toggleLayer(l.id)} />
                  <Label htmlFor={`${id}-l-${l.id}`} className={cn('flex-1 flex-col items-start gap-0.5 text-base leading-snug', disabled && 'opacity-70')}>
                    <span className="flex items-center gap-2">
                      <LayerIcon name={l.icon} color={l.iconColor} className="size-4" /> {l.name}
                    </span>
                    {mode === 'value' ? (
                      label ? (
                        <span className="text-sm font-normal text-muted-foreground">Aporta: {label}</span>
                      ) : (
                        <span className="text-sm font-normal text-muted-foreground">Esta capa no tiene un campo numérico para mapas de calor.</span>
                      )
                    ) : null}
                  </Label>
                </li>
              );
            })}
          </ul>
          {mode === 'value' && valueLayersCount > 1 ? (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertDescription className="text-amber-900">Los valores se suman tal cual; úsalo con capas que midan lo mismo (por ejemplo, montos en pesos).</AlertDescription>
            </Alert>
          ) : null}
        </fieldset>

        <fieldset disabled={!active} className="space-y-3 disabled:opacity-60">
          <legend className="text-sm font-medium">Ajustes</legend>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <Label htmlFor={`${id}-radius`}>Radio</Label>
              <span className="tabular-nums">{settings.radius} px</span>
            </div>
            <Slider id={`${id}-radius`} min={10} max={80} step={5} value={[settings.radius]} onValueChange={([v]) => onChangeSettings({ ...settings, radius: v ?? settings.radius })} aria-label="Radio del mapa de calor" />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <Label htmlFor={`${id}-intensity`}>Intensidad</Label>
              <span className="tabular-nums">{settings.intensity.toFixed(1)}</span>
            </div>
            <Slider id={`${id}-intensity`} min={0.2} max={3} step={0.1} value={[settings.intensity]} onValueChange={([v]) => onChangeSettings({ ...settings, intensity: v ?? settings.intensity })} aria-label="Intensidad del mapa de calor" />
          </div>
          <div className="flex items-center gap-3">
            <Checkbox id={`${id}-points`} className="size-5" checked={settings.showPoints} onCheckedChange={(c) => onChangeSettings({ ...settings, showPoints: c === true })} />
            <Label htmlFor={`${id}-points`} className="text-base">
              Mostrar puntos
            </Label>
          </div>
          <div className="space-y-1">
            <div className="h-3 rounded-full" style={{ background: 'linear-gradient(to right, rgba(33,102,172,0), #67a9cf, #a1dab4, #fecc5c, #fd8d3c, #e31a1c)' }} aria-hidden />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Menos</span>
              <span>Más</span>
            </div>
          </div>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
