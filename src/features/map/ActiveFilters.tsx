'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LayerWithCount } from '@/shared/types';
import { useFilterOptions } from './hooks';
import type { LocationFilter, NumberFilter } from './url-state';

type Props = {
  layer: LayerWithCount;
  filters: Record<string, string[]>;
  loc: LocationFilter | null;
  num: NumberFilter | null;
  onChange: (filters: Record<string, string[]>, loc: LocationFilter | null, num: NumberFilter | null) => void;
};

const locLabels: Record<LocationFilter, string> = {
  none: 'Sin coordenadas',
  approx: 'Ubicación aproximada por dirección',
};

function valuesText(values: string[]): string {
  const shown = values.slice(0, 2).map((v) => (v === '' ? '(Vacío)' : v));
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} y ${rest} más` : shown.join(', ');
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="flex min-h-11 items-center gap-1 rounded-full border border-primary/30 bg-primary-soft py-1 pr-1 pl-4 text-base text-primary-dark">
      <span>{label}</span>
      <Button
        variant="ghost"
        size="icon-lg"
        className="size-9 rounded-full hover:bg-primary/10"
        onClick={onRemove}
        aria-label={`Quitar el filtro ${label}`}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

/**
 * Franja con los filtros aplicados bajo la barra superior: deja a la vista por qué faltan registros
 * y permite quitar cada filtro con un clic, en el mapa y en la tabla.
 */
export function ActiveFilters({ layer, filters, loc, num, onChange }: Props) {
  const options = useFilterOptions(
    layer.id,
    Object.values(filters).some((v) => v.length > 0),
  );
  const autoField = layer.fields.find((f) => f.type === 'autonumber');
  const fieldEntries = layer.fields
    .filter((f) => (filters[f.key]?.length ?? 0) > 0)
    .map((f) => {
      const values = filters[f.key]!;
      const prefix = options.data?.[f.key] === 'text';
      return {
        key: f.key,
        label: prefix ? `${f.label}: empieza con “${values[0]}”` : `${f.label}: ${valuesText(values)}`,
      };
    });

  if (!fieldEntries.length && !loc && !num) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2"
      role="region"
      aria-label="Filtros aplicados"
    >
      <span className="text-base text-muted-foreground">Mostrando solo:</span>
      <ul className="flex flex-wrap items-center gap-2">
        {loc ? <Chip label={locLabels[loc]} onRemove={() => onChange(filters, null, num)} /> : null}
        {num ? (
          <Chip
            label={`${autoField?.label ?? 'Número'}: ${num === 'with' ? 'con número' : 'sin número'}`}
            onRemove={() => onChange(filters, loc, null)}
          />
        ) : null}
        {fieldEntries.map((e) => (
          <Chip
            key={e.key}
            label={e.label}
            onRemove={() => {
              const next = { ...filters };
              delete next[e.key];
              onChange(next, loc, num);
            }}
          />
        ))}
      </ul>
      <Button variant="link" className="h-11 px-2 text-base" onClick={() => onChange({}, null, null)}>
        Quitar todos los filtros
      </Button>
    </div>
  );
}
