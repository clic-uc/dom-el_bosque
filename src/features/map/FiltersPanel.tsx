'use client';

import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { ErrorState, LoadingState } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { errorMessage } from '@/lib/api';
import { normalizeText } from '@/shared/text';
import type { LayerField, LayerWithCount } from '@/shared/types';
import { useFilterOptions } from './hooks';
import { PanelSection, SidePanel } from './SidePanel';
import type { LocationFilter, NumberFilter } from './url-state';

type Props = {
  layer: LayerWithCount;
  filters: Record<string, string[]>;
  loc: LocationFilter | null;
  num: NumberFilter | null;
  onApply: (filters: Record<string, string[]>, loc: LocationFilter | null, num: NumberFilter | null) => void;
  onClose: () => void;
};

const EMPTY_LABEL = '(Vacío)';

function ValueList({ field, options, selected, onChange }: { field: LayerField; options: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const q = normalizeText(search);
    return q ? options.filter((o) => normalizeText(o || EMPTY_LABEL).includes(q)) : options;
  }, [options, search]);

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  return (
    <div className="space-y-2">
      {options.length > 8 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Buscar en ${field.label}`} aria-label={`Buscar valores de ${field.label}`} className="h-11 pl-9 text-base" />
        </div>
      ) : null}
      <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-1" aria-label={`Valores de ${field.label}`}>
        {shown.length === 0 ? <li className="px-2 py-2 text-sm text-muted-foreground">Ningún valor coincide.</li> : null}
        {shown.map((v) => {
          const cid = `${id}-${v || 'vacio'}`;
          return (
            <li key={v} className="flex min-h-10 items-center gap-3 rounded-sm px-2 hover:bg-muted">
              <Checkbox id={cid} className="size-5" checked={selected.includes(v)} onCheckedChange={() => toggle(v)} />
              <Label htmlFor={cid} className={`flex-1 cursor-pointer py-2 text-base font-normal ${v === '' ? 'text-muted-foreground italic' : ''}`}>
                {v === '' ? EMPTY_LABEL : v}
              </Label>
            </li>
          );
        })}
      </ul>
      {selected.length ? (
        <p className="text-sm text-muted-foreground">
          {selected.length} {selected.length === 1 ? 'valor seleccionado' : 'valores seleccionados'}
        </p>
      ) : null}
    </div>
  );
}

/** Panel de filtros de la capa de trabajo (§10.2). Aplicar/Limpiar actualizan la URL. */
export function FiltersPanel({ layer, filters, loc, num, onApply, onClose }: Props) {
  const id = useId();
  const options = useFilterOptions(layer.id);
  const [draft, setDraft] = useState<Record<string, string[]>>(filters);
  const [draftLoc, setDraftLoc] = useState<LocationFilter | null>(loc);
  const [draftNum, setDraftNum] = useState<NumberFilter | null>(num);

  useEffect(() => {
    setDraft(filters);
    setDraftLoc(loc);
    setDraftNum(num);
  }, [filters, loc, num, layer.id]);

  const autoField = layer.fields.find((f) => f.type === 'autonumber');
  const fields = layer.fields.filter((f) => f.type !== 'autonumber');

  function setField(key: string, values: string[]) {
    setDraft((d) => {
      const next = { ...d };
      if (values.length) next[key] = values;
      else delete next[key];
      return next;
    });
  }

  function clean(d: Record<string, string[]>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(d)) if (v.length) out[k] = v;
    return out;
  }

  return (
    <SidePanel
      title="Filtros"
      subtitle={`Capa ${layer.name}`}
      onClose={onClose}
      width={400}
      data-testid="filters-panel"
      footer={
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              setDraft({});
              setDraftLoc(null);
              setDraftNum(null);
              onApply({}, null, null);
            }}
          >
            Limpiar
          </Button>
          <Button size="lg" onClick={() => onApply(clean(draft), draftLoc, draftNum)}>
            Aplicar filtros
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <PanelSection title="Ubicación">
          <RadioGroup value={draftLoc ?? 'all'} onValueChange={(v) => setDraftLoc(v === 'all' ? null : (v as LocationFilter))} className="gap-1">
            {[
              { v: 'all', label: 'Todos los registros' },
              { v: 'none', label: 'Sin coordenadas (solo en la tabla)' },
              { v: 'approx', label: 'Ubicación aproximada por dirección' },
            ].map((o) => (
              <div key={o.v} className="flex min-h-11 items-center gap-3 px-1">
                <RadioGroupItem id={`${id}-loc-${o.v}`} value={o.v} className="size-5" />
                <Label htmlFor={`${id}-loc-${o.v}`} className="text-base font-normal">
                  {o.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </PanelSection>

        {autoField ? (
          <PanelSection title={autoField.label}>
            <RadioGroup value={draftNum ?? 'all'} onValueChange={(v) => setDraftNum(v === 'all' ? null : (v as NumberFilter))} className="gap-1">
              {[
                { v: 'all', label: 'Todos' },
                { v: 'with', label: 'Con número' },
                { v: 'without', label: 'Sin número' },
              ].map((o) => (
                <div key={o.v} className="flex min-h-11 items-center gap-3 px-1">
                  <RadioGroupItem id={`${id}-num-${o.v}`} value={o.v} className="size-5" />
                  <Label htmlFor={`${id}-num-${o.v}`} className="text-base font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </PanelSection>
        ) : null}

        {options.isPending ? (
          <LoadingState rows={4} label="Cargando los valores de los campos…" />
        ) : options.isError ? (
          <ErrorState title="No se pudieron cargar los filtros" message={errorMessage(options.error)} onRetry={() => void options.refetch()} />
        ) : (
          fields.map((f) => {
            const opt = options.data?.[f.key];
            const selected = draft[f.key] ?? [];
            return (
              <PanelSection key={f.key} title={f.label}>
                {Array.isArray(opt) ? (
                  <ValueList field={f} options={opt} selected={selected} onChange={(v) => setField(f.key, v)} />
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-f-${f.key}`} className="text-base font-normal">
                      Empieza con…
                    </Label>
                    <Input id={`${id}-f-${f.key}`} className="h-11 text-base" value={selected[0] ?? ''} onChange={(e) => setField(f.key, e.target.value ? [e.target.value] : [])} placeholder="Escribe el inicio del valor" />
                  </div>
                )}
              </PanelSection>
            );
          })
        )}
        {!options.isPending && fields.length === 0 ? <p className="text-sm text-muted-foreground">Esta capa no tiene campos para filtrar.</p> : null}
      </div>
    </SidePanel>
  );
}
