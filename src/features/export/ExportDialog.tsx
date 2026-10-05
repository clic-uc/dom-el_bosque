'use client';

import { Download } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { LayerIcon } from '@/components/shared/layer-icon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HelpLink } from '@/features/help/HelpLink';
import { formatInt } from '@/lib/format';
import { slugify } from '@/shared/text';
import type { LayerWithCount } from '@/shared/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layers: LayerWithCount[];
  defaultLayerId: number | null;
};

type Delimiter = ';' | ',';

/** Exportar una capa a CSV (§10.2). La descarga la hace el navegador desde `/api/layers/:id/export`. */
export function ExportDialog({ open, onOpenChange, layers, defaultLayerId }: Props) {
  const id = useId();
  const [layerId, setLayerId] = useState<number | null>(defaultLayerId);
  const [delimiter, setDelimiter] = useState<Delimiter>(';');

  useEffect(() => {
    if (open) setLayerId(defaultLayerId ?? layers[0]?.id ?? null);
  }, [open, defaultLayerId, layers]);

  const layer = layers.find((l) => l.id === layerId) ?? null;
  const columns = layer ? [...(layer.hasRole ? ['Rol SII'] : []), 'Latitud', 'Longitud', ...layer.fields.map((f) => f.label), 'Comentarios'] : [];

  function download() {
    if (!layer) return;
    const a = document.createElement('a');
    a.href = `/api/layers/${layer.id}/export?delimiter=${encodeURIComponent(delimiter)}`;
    a.download = `${slugify(layer.name)}.csv`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`Descargando ${layer.name} (${formatInt(layer.recordCount)} registros). Revisa la carpeta de descargas.`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1 text-xl">
            Exportar a CSV <HelpLink slug="exportacion" label="¿Cómo abrir el archivo en Excel?" />
          </DialogTitle>
          <DialogDescription className="text-base">Descarga todos los registros de una capa en un archivo que se abre en Excel.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-layer`} className="text-base">
              Capa
            </Label>
            <Select value={layerId ? String(layerId) : ''} onValueChange={(v) => setLayerId(Number(v))}>
              <SelectTrigger id={`${id}-layer`} className="h-11 w-full text-base">
                <SelectValue placeholder="Elige una capa" />
              </SelectTrigger>
              <SelectContent>
                {layers.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)} className="min-h-11 text-base">
                    <span className="flex items-center gap-2">
                      <LayerIcon name={l.icon} color={l.iconColor} className="size-4" />
                      {l.name} ({formatInt(l.recordCount)})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-base font-medium">Separador de columnas</legend>
            <RadioGroup value={delimiter} onValueChange={(v) => setDelimiter(v as Delimiter)} className="gap-1">
              <div className="flex min-h-11 items-center gap-3">
                <RadioGroupItem id={`${id}-semi`} value=";" className="size-5" />
                <Label htmlFor={`${id}-semi`} className="text-base font-normal">
                  Punto y coma ( ; ) — recomendado para Excel en español
                </Label>
              </div>
              <div className="flex min-h-11 items-center gap-3">
                <RadioGroupItem id={`${id}-comma`} value="," className="size-5" />
                <Label htmlFor={`${id}-comma`} className="text-base font-normal">
                  Coma ( , )
                </Label>
              </div>
            </RadioGroup>
          </fieldset>

          {layer ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Columnas incluidas:</span> {columns.join(', ')}.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="lg" onClick={download} disabled={!layer}>
            <Download aria-hidden /> Exportar CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
