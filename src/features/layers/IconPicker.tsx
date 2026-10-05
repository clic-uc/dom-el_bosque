'use client';

import { Check, icons } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LayerIcon } from '@/components/shared/layer-icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { DEFAULT_LAYER_ICON, DEFAULT_LAYER_ICON_COLOR, iconPalette } from '@/shared/constants';
import { normalizeText } from '@/shared/text';

/** 'Building2' → 'building-2'; 'AArrowDown' → 'a-arrow-down'; 'Clock12' → 'clock-12'. */
function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
}

let cachedNames: string[] | null = null;
/** Nombres kebab-case de todos los íconos de lucide (~1.900), calculados una sola vez al abrir el selector. */
function lucideIconNames(): string[] {
  if (!cachedNames) cachedNames = Object.keys(icons).map(pascalToKebab).sort();
  return cachedNames;
}

const MAX_RESULTS = 160;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: string;
  color: string;
  onSave: (icon: string, color: string) => void;
};

/** Selector de ícono y color de una capa (§10.2 "IconPicker"). Los cambios se aplican solo con "Guardar cambios". */
export function IconPicker({ open, onOpenChange, icon, color, onSave }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-3xl">
        {/* El contenido se monta al abrir: el borrador parte siempre del ícono y color actuales. */}
        {open ? <IconPickerBody icon={icon} color={color} onSave={onSave} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function IconPickerBody({
  icon,
  color,
  onSave,
  onClose,
}: {
  icon: string;
  color: string;
  onSave: (icon: string, color: string) => void;
  onClose: () => void;
}) {
  const [draftIcon, setDraftIcon] = useState(icon || DEFAULT_LAYER_ICON);
  const [draftColor, setDraftColor] = useState(color || DEFAULT_LAYER_ICON_COLOR);
  const [hexText, setHexText] = useState(color || DEFAULT_LAYER_ICON_COLOR);
  const [search, setSearch] = useState('');

  const { results, total } = useMemo(() => {
    const names = lucideIconNames();
    const q = normalizeText(search).replace(/\s+/g, '-');
    const filtered = q ? names.filter((n) => n.includes(q)) : names;
    // el ícono actual siempre visible al inicio
    const ordered = filtered.includes(draftIcon) ? [draftIcon, ...filtered.filter((n) => n !== draftIcon)] : filtered;
    return { results: ordered.slice(0, MAX_RESULTS), total: filtered.length };
  }, [search, draftIcon]);

  const hexValid = HEX_RE.test(hexText);

  function pickColor(hex: string) {
    setDraftColor(hex.toLowerCase());
    setHexText(hex.toLowerCase());
  }

  function applyHex(value: string) {
    setHexText(value);
    if (HEX_RE.test(value)) setDraftColor(value.toLowerCase());
  }

  return (
    <>
      <DialogHeader className="border-b px-6 py-4 text-left">
        <DialogTitle className="text-xl">Ícono y color de la capa</DialogTitle>
        <DialogDescription className="text-base">
          Así se verán los puntos de esta capa en el mapa. Elige un color y busca un ícono.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <div className="flex items-center gap-4">
          <div
            className="flex size-16 shrink-0 items-center justify-center rounded-full border-[3px] bg-white shadow-sm"
            style={{ borderColor: draftColor }}
            aria-hidden
          >
            <LayerIcon name={draftIcon} color={draftColor} size={48} />
          </div>
          <div className="text-base">
            <p className="font-medium">Vista previa</p>
            <p className="text-muted-foreground">
              Ícono <span className="font-mono">{draftIcon}</span> · Color <span className="font-mono">{draftColor}</span>
            </p>
          </div>
        </div>

        <section className="space-y-3">
          <p className="text-base font-medium">Color</p>
          <div className="flex flex-wrap items-center gap-2">
            {iconPalette.map((c) => {
              const selected = c.hex.toLowerCase() === draftColor.toLowerCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  title={c.name}
                  aria-label={`Color ${c.name}`}
                  aria-pressed={selected}
                  onClick={() => pickColor(c.hex)}
                  className={cn(
                    'flex size-11 items-center justify-center rounded-full border-2 border-white shadow outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary',
                    selected && 'ring-2 ring-foreground',
                  )}
                  style={{ backgroundColor: c.hex }}
                >
                  {selected ? <Check className="size-5 text-white" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="icon-color-input" className="text-base">
                Otro color
              </Label>
              <input
                id="icon-color-input"
                type="color"
                value={draftColor}
                onChange={(e) => pickColor(e.target.value)}
                className="h-11 w-16 cursor-pointer rounded-md border p-1"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="icon-hex-input" className="text-base">
                Código del color
              </Label>
              <Input
                id="icon-hex-input"
                value={hexText}
                onChange={(e) => applyHex(e.target.value.trim())}
                aria-invalid={!hexValid}
                className="h-11 w-36 font-mono text-base"
                placeholder="#3b82f6"
              />
            </div>
            {!hexValid ? (
              <p className="text-sm text-destructive">Escribe un código como #3b82f6 (6 letras o números).</p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="icon-search" className="text-base font-medium">
              Buscar ícono
            </Label>
            <Input
              id="icon-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Por ejemplo: house, tree, car, fire…"
              className="h-11 text-base"
              autoComplete="off"
            />
            <p className="text-sm text-muted-foreground">
              Los nombres de los íconos están en inglés.{' '}
              {total > MAX_RESULTS
                ? `Mostrando ${MAX_RESULTS} de ${total}; escribe más letras para acotar la búsqueda.`
                : `${total} ícono${total === 1 ? '' : 's'}.`}
            </p>
          </div>
          {results.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-base text-muted-foreground">
              No encontramos íconos con «{search}». Prueba con otra palabra en inglés.
            </p>
          ) : (
            <div role="listbox" aria-label="Íconos" className="grid grid-cols-8 gap-2">
              {results.map((name) => {
                const selected = name === draftIcon;
                return (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    title={name}
                    aria-label={name}
                    onClick={() => setDraftIcon(name)}
                    className={cn(
                      'flex h-12 items-center justify-center rounded-md border outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary',
                      selected && 'border-primary bg-primary-soft ring-2 ring-primary',
                    )}
                  >
                    <LayerIcon name={name} color={draftColor} className="size-6" />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button type="button" variant="outline" className="h-11 text-base" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          className="h-11 text-base"
          disabled={!hexValid}
          onClick={() => {
            onSave(draftIcon, draftColor);
            onClose();
          }}
        >
          Guardar cambios
        </Button>
      </DialogFooter>
    </>
  );
}
