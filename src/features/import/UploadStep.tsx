'use client';

import { FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HelpLink } from '@/features/help/HelpLink';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { capabilities, DEFAULT_IMPORT_MAX_MB } from '@/shared/capabilities';
import type { ImportSource } from '@/shared/types';
import { usePatchSource, useUploadImport } from './hooks';

const MAX_MB = capabilities.importMaxMb ?? DEFAULT_IMPORT_MAX_MB;
const ACCEPT = '.csv,.xlsx';

const delimiterOptions = [
  { value: 'auto', label: 'Detectar automáticamente' },
  { value: ',', label: 'Coma ( , )' },
  { value: ';', label: 'Punto y coma ( ; )' },
  { value: '\t', label: 'Tabulación' },
  { value: '|', label: 'Barra ( | )' },
] as const;

type Props = {
  layerId: number;
  source: ImportSource | null;
  onSource: (source: ImportSource) => void;
  onNext: () => void;
};

/** Paso 1 — Archivo (§10.2): dropzone accesible, hoja / fila de encabezados / delimitador y vista previa de 20 filas. */
export function UploadStep({ layerId, source, onSource, onNext }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const upload = useUploadImport();
  const patch = usePatchSource(source?.importId ?? null);

  function pick(file: File | undefined) {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv' && ext !== 'xlsx') {
      setFileError(
        `"${file.name}" no es un archivo .csv ni .xlsx. Si es Excel antiguo (.xls), guárdalo como .xlsx.`,
      );
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setFileError(`"${file.name}" pesa más de ${MAX_MB} MB. Divide la planilla en partes más pequeñas.`);
      return;
    }
    setFileError(null);
    upload.mutate(
      { layerId, file },
      {
        onSuccess: (s) => onSource(s),
        onError: (err) => setFileError(errorMessage(err)),
      },
    );
  }

  function change(p: { sheetName?: string; headerRow?: number; delimiter?: ',' | ';' | '\t' | '|' }) {
    patch.mutate(p, {
      onSuccess: (s) => onSource(s),
      onError: (err) => toast.error(errorMessage(err)),
    });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Elige el archivo con los registros</h3>
          <p className="text-base text-muted-foreground">
            Se aceptan planillas Excel (.xlsx) o CSV de hasta {MAX_MB} MB
            {capabilities.importMaxRows
              ? ` y ${capabilities.importMaxRows.toLocaleString('es-CL')} filas`
              : ''}
            , con una fila de encabezados.
          </p>
          {capabilities.notices.importLimits ? (
            <p className="mt-1 text-sm text-amber-900">{capabilities.notices.importLimits}</p>
          ) : null}
        </div>
        <HelpLink slug="importacion/preparar-archivo" label="Cómo preparar el archivo" withText />
      </div>

      <div
        role="group"
        aria-labelledby={`${id}-drop-label`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-border bg-muted/40',
        )}
      >
        {upload.isPending ? (
          <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
        ) : source ? (
          <FileSpreadsheet className="size-8 text-primary" aria-hidden />
        ) : (
          <UploadCloud className="size-8 text-muted-foreground" aria-hidden />
        )}
        <p id={`${id}-drop-label`} className="text-base">
          {upload.isPending
            ? 'Subiendo y leyendo el archivo…'
            : source
              ? 'Archivo cargado. Puedes elegir otro si te equivocaste.'
              : 'Arrastra el archivo aquí o elígelo desde tu computador'}
        </p>
        <input
          ref={inputRef}
          id={`${id}-file`}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          size="lg"
          className="h-11 text-base"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          {source ? 'Elegir otro archivo' : 'Elegir archivo'}
        </Button>
        {fileError ? (
          <p role="alert" className="max-w-xl text-sm text-destructive">
            {fileError}
          </p>
        ) : null}
      </div>

      {source ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {source.fileType === 'xlsx' && source.sheets && source.sheets.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-sheet`} className="text-base">
                  Hoja de la planilla
                </Label>
                <Select
                  value={source.sheetName ?? source.sheets[0]}
                  onValueChange={(v) => change({ sheetName: v })}
                  disabled={patch.isPending}
                >
                  <SelectTrigger id={`${id}-sheet`} className="h-11 w-full text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {source.sheets.map((s) => (
                      <SelectItem key={s} value={s} className="text-base">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-header`} className="text-base">
                Fila con los nombres de las columnas
              </Label>
              <Input
                id={`${id}-header`}
                type="number"
                min={1}
                className="h-11 text-base"
                defaultValue={source.headerRow}
                key={`${source.importId}-${source.sheetName}-${source.headerRow}`}
                disabled={patch.isPending}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n !== source.headerRow) change({ headerRow: n });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <p className="text-sm text-muted-foreground">
                Cámbiala si la planilla tiene títulos sobre los encabezados.
              </p>
            </div>
            {source.fileType === 'csv' ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-delim`} className="text-base">
                  Separador de columnas
                </Label>
                <Select
                  value={source.delimiter ?? 'auto'}
                  onValueChange={(v) =>
                    change({ delimiter: v === 'auto' ? undefined : (v as ',' | ';' | '\t' | '|') })
                  }
                  disabled={patch.isPending}
                >
                  <SelectTrigger id={`${id}-delim`} className="h-11 w-full text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {delimiterOptions.map((d) => (
                      <SelectItem key={d.value} value={d.value} className="text-base">
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-right">Fila</TableHead>
                  {source.headers.map((h) => (
                    <TableHead key={h} className="whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {source.preview.map((r) => (
                  <TableRow key={r.rowNumber}>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.rowNumber}
                    </TableCell>
                    {source.headers.map((h) => (
                      <TableCell key={h} className="max-w-56 truncate">
                        {r.values[h]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {patch.isPending
              ? 'Volviendo a leer el archivo…'
              : `Vista previa de las primeras ${Math.min(20, source.preview.length)} filas. El archivo tiene ${source.totalRows.toLocaleString('es-CL')} filas con datos.`}
          </p>
        </>
      ) : null}

      <div className="flex justify-end border-t pt-4">
        <Button
          type="button"
          size="lg"
          className="h-11 text-base"
          disabled={!source || patch.isPending || upload.isPending}
          onClick={onNext}
        >
          Continuar
        </Button>
      </div>
    </div>
  );
}
