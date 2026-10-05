'use client';

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type ColumnSizingState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, MapPin, MapPinOff, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCan } from '@/features/auth/actor-context';
import { useDeleteRecord, useRecordsPage, useUpdateRecord, type RecordsPageParams } from '@/features/map/hooks';
import type { SortDir } from '@/features/map/url-state';
import { errorMessage } from '@/lib/api';
import { formatCoord, formatDateTime, formatFieldValue, formatInt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PAGE_SIZES } from '@/shared/constants';
import type { UpdateRecordInput } from '@/shared/schemas/records';
import { tryNormalizeRoleId } from '@/shared/role-id';
import type { LayerField, LayerWithCount, RecordListItem } from '@/shared/types';
import { coerceFieldValue, FieldInput, toFieldValue, type FieldValue } from './FieldInput';

export type RecordsTableProps = {
  layer: LayerWithCount;
  params: RecordsPageParams;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSortChange: (sort: string, dir: SortDir) => void;
  onOpenRecord: (recordId: number) => void;
  onOpenRole: (roleId: string) => void;
  onViewOnMap: (record: RecordListItem) => void;
};

type Draft = { roleId: string; lat: string; lon: string; attributes: Record<string, FieldValue> };

function draftFrom(r: RecordListItem, fields: LayerField[]): Draft {
  const attributes: Record<string, FieldValue> = {};
  for (const f of fields) attributes[f.key] = toFieldValue(f, r.attributes[f.key]);
  return { roleId: r.roleId ?? '', lat: r.lat === null ? '' : formatCoord(r.lat), lon: r.lon === null ? '' : formatCoord(r.lon), attributes };
}

function parseCoord(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Tabla de registros de la capa de trabajo (§10.2): datos del servidor, edición en línea, paginación. */
export function RecordsTable({ layer, params, onPageChange, onPageSizeChange, onSortChange, onOpenRecord, onOpenRole, onViewOnMap }: RecordsTableProps) {
  const can = useCan();
  const canEdit = can('records.write');
  const query = useRecordsPage(layer.id, params);
  const update = useUpdateRecord();
  const remove = useDeleteRecord();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<RecordListItem | null>(null);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  const editableFields = useMemo(() => layer.fields.filter((f) => f.type !== 'autonumber'), [layer.fields]);
  const autoField = layer.fields.find((f) => f.type === 'autonumber');

  function startEdit(r: RecordListItem) {
    if (!canEdit) return;
    setEditingId(r.id);
    setDraft(draftFrom(r, editableFields));
    setEditError(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setEditError(null);
  }
  async function saveEdit(r: RecordListItem) {
    if (!draft) return;
    const patch: UpdateRecordInput = {};
    if (layer.hasRole) {
      const parsed = tryNormalizeRoleId(draft.roleId);
      if (!parsed.ok) {
        setEditError('El rol debe tener el formato 00000-00000.');
        return;
      }
      if (parsed.value !== r.roleId) patch.roleId = parsed.value;
    }
    const lat = parseCoord(draft.lat);
    const lon = parseCoord(draft.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      setEditError('Las coordenadas deben ser números.');
      return;
    }
    if ((lat === null) !== (lon === null)) {
      setEditError('Latitud y longitud van juntas.');
      return;
    }
    if (lat !== r.lat || lon !== r.lon) {
      patch.lat = lat;
      patch.lon = lon;
    }
    const attrs: Record<string, unknown> = {};
    for (const f of editableFields) {
      const v = coerceFieldValue(f, draft.attributes[f.key]);
      const prev = r.attributes[f.key] ?? null;
      if (v !== (prev === '' ? null : prev)) attrs[f.key] = v;
      if (f.required && v === null) {
        setEditError(`Completa el campo "${f.label}".`);
        return;
      }
    }
    if (Object.keys(attrs).length) patch.attributes = attrs;
    if (!Object.keys(patch).length) {
      cancelEdit();
      return;
    }
    try {
      await update.mutateAsync({ id: r.id, patch });
      cancelEdit();
    } catch (e) {
      setEditError(errorMessage(e));
    }
  }

  const sortKeyOf = (colId: string) => (colId === 'roleId' || colId === 'lat' || colId === 'lon' || colId === 'updatedAt' ? colId : colId.startsWith('attr:') ? colId : null);

  const columns = useMemo<ColumnDef<RecordListItem>[]>(() => {
    const cols: ColumnDef<RecordListItem>[] = [];
    cols.push({
      id: 'status',
      header: () => <span className="sr-only">Ubicación</span>,
      size: 44,
      enableResizing: false,
      cell: ({ row }) => {
        const r = row.original;
        if (r.lat === null) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" aria-label="Sin coordenadas">
                  <MapPinOff className="size-4 text-muted-foreground" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>Sin coordenadas: no aparece en el mapa</TooltipContent>
            </Tooltip>
          );
        }
        if (r.coordsSource === 'geocoded') {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" aria-label="Ubicación aproximada">
                  <MapPin className="size-4 text-amber-600" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>Ubicación aproximada por dirección</TooltipContent>
            </Tooltip>
          );
        }
        return null;
      },
    });
    if (layer.hasRole) {
      cols.push({
        id: 'roleId',
        header: 'Rol SII',
        size: 150,
        cell: ({ row }) => {
          const r = row.original;
          if (editingId === r.id && draft) {
            return <Input aria-label="Rol SII" className="h-10 font-mono text-base" value={draft.roleId} onChange={(e) => setDraft({ ...draft, roleId: e.target.value })} />;
          }
          return r.roleId ? (
            <button
              type="button"
              className="font-mono text-primary underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onOpenRole(r.roleId!);
              }}
            >
              {r.roleId}
            </button>
          ) : (
            <span className="text-muted-foreground">Sin rol</span>
          );
        },
      });
    }
    if (autoField) {
      cols.push({
        id: `attr:${autoField.key}`,
        header: autoField.label,
        size: 140,
        cell: ({ row }) => {
          const v = row.original.attributes[autoField.key];
          return typeof v === 'number' ? <span className="font-semibold tabular-nums">{formatInt(v)}</span> : <span className="text-muted-foreground">Sin número</span>;
        },
      });
    }
    for (const key of ['lat', 'lon'] as const) {
      cols.push({
        id: key,
        header: key === 'lat' ? 'Latitud' : 'Longitud',
        size: 130,
        cell: ({ row }) => {
          const r = row.original;
          if (editingId === r.id && draft) {
            return <Input aria-label={key === 'lat' ? 'Latitud' : 'Longitud'} inputMode="decimal" className="h-10 text-base" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />;
          }
          return (
            <span
              className={cn('tabular-nums', canEdit && 'cursor-text')}
              onClick={(e) => {
                if (!canEdit) return;
                e.stopPropagation();
                startEdit(r);
              }}
              title={canEdit ? 'Haz clic para editar' : undefined}
            >
              {r[key] === null ? <span className="text-muted-foreground">—</span> : formatCoord(r[key])}
            </span>
          );
        },
      });
    }
    for (const f of editableFields) {
      cols.push({
        id: `attr:${f.key}`,
        header: f.label,
        size: 180,
        cell: ({ row }) => {
          const r = row.original;
          if (editingId === r.id && draft) {
            return <FieldInput field={f} compact value={draft.attributes[f.key] ?? ''} onChange={(v) => setDraft({ ...draft, attributes: { ...draft.attributes, [f.key]: v } })} aria-describedby={undefined} />;
          }
          const text = formatFieldValue(r.attributes[f.key], f.type);
          return text ? <span title={text}>{text}</span> : <span className="text-muted-foreground">—</span>;
        },
      });
    }
    cols.push({
      id: 'updatedAt',
      header: 'Actualizado',
      size: 160,
      cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>,
    });
    if (canEdit) {
      cols.push({
        id: 'actions',
        header: 'Acciones',
        size: 300,
        enableResizing: false,
        cell: ({ row }) => {
          const r = row.original;
          const editing = editingId === r.id;
          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {editing ? (
                <>
                  <Button size="sm" className="h-10" onClick={() => void saveEdit(r)} disabled={update.isPending}>
                    {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null} Guardar
                  </Button>
                  <Button size="sm" variant="outline" className="h-10" onClick={cancelEdit} disabled={update.isPending}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="h-10" onClick={() => startEdit(r)}>
                    <Pencil aria-hidden /> Editar
                  </Button>
                  {r.lat !== null ? (
                    <Button size="sm" variant="ghost" className="h-10" onClick={() => onViewOnMap(r)}>
                      <MapPin aria-hidden /> Ver en mapa
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="h-10 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setToDelete(r)} aria-label={`Eliminar registro ${r.id}`}>
                    <Trash2 aria-hidden /> Eliminar
                  </Button>
                </>
              )}
            </div>
          );
        },
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- las funciones de edición dependen de estado ya incluido
  }, [layer.hasRole, autoField, editableFields, editingId, draft, canEdit, update.isPending, onOpenRole, onViewOnMap]);

  const data = query.data?.data ?? [];
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { columnSizing },
    onColumnSizingChange: setColumnSizing,
    getRowId: (r) => String(r.id),
  });

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize));
  const from = total === 0 ? 0 : (params.page - 1) * params.pageSize + 1;
  const to = Math.min(total, params.page * params.pageSize);

  function toggleSort(colId: string) {
    const key = sortKeyOf(colId);
    if (!key) return;
    if (params.sort === key) onSortChange(key, params.dir === 'asc' ? 'desc' : 'asc');
    else onSortChange(key, key === 'updatedAt' ? 'desc' : 'asc');
  }

  if (query.isError) {
    return <ErrorState title="No se pudo cargar la tabla" message={errorMessage(query.error)} onRetry={() => void query.refetch()} className="h-full" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="records-table">
      <div className="relative min-h-0 flex-1 overflow-auto">
        {query.isPending ? (
          <div className="flex h-full items-center justify-center text-muted-foreground" role="status">
            <Loader2 className="mr-2 animate-spin" aria-hidden /> Cargando registros…
          </div>
        ) : total === 0 ? (
          <EmptyState
            title={params.search || Object.keys(params.filters ?? {}).length ? 'Ningún registro coincide' : 'Esta capa no tiene registros'}
            description={params.search || Object.keys(params.filters ?? {}).length ? 'Prueba con otra búsqueda o limpia los filtros.' : canEdit ? 'Crea el primero con “Crear registro” o importa una planilla con “Importar”.' : 'Aún no se han cargado registros en esta capa.'}
            className="h-full"
          />
        ) : (
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm" style={{ width: table.getTotalSize() }}>
            <thead className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const sortable = sortKeyOf(header.column.id) !== null;
                    const active = params.sort === header.column.id;
                    const isActions = header.column.id === 'actions';
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        style={{ width: header.getSize() }}
                        className={cn('relative h-12 border-b px-2 text-left font-semibold whitespace-nowrap', isActions && 'sticky right-0 z-20 bg-muted shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]')}
                      >
                        {sortable ? (
                          <button type="button" className="inline-flex h-10 max-w-full items-center gap-1 rounded-sm px-1 hover:bg-background/60" onClick={() => toggleSort(header.column.id)}>
                            <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            {active ? params.dir === 'asc' ? <ArrowUp className="size-4" aria-hidden /> : <ArrowDown className="size-4" aria-hidden /> : <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden />}
                          </button>
                        ) : (
                          <span className="px-1">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                        )}
                        {header.column.getCanResize() ? (
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Cambiar ancho de la columna ${String(header.column.columnDef.header)}`}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className={cn('absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/40', header.column.getIsResizing() && 'bg-primary')}
                          />
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className={cn(query.isFetching && 'opacity-60 transition-opacity')}>
              {table.getRowModel().rows.map((row) => {
                const editing = editingId === row.original.id;
                return (
                  <tr
                    key={row.id}
                    className={cn('group h-12 hover:bg-muted/50', !editing && 'cursor-pointer', editing && 'bg-primary-soft/40')}
                    onClick={() => !editing && onOpenRecord(row.original.id)}
                    onKeyDown={(e) => {
                      if (!editing && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                        e.preventDefault();
                        onOpenRecord(row.original.id);
                      }
                    }}
                    tabIndex={editing ? -1 : 0}
                    aria-label={`Registro ${row.original.id}`}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isActions = cell.column.id === 'actions';
                      return (
                        <td key={cell.id} style={{ width: cell.column.getSize(), maxWidth: cell.column.getSize() }} className={cn('truncate border-b px-2 py-1 whitespace-nowrap', isActions && 'sticky right-0 z-10 bg-background shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)] group-hover:bg-muted')}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {editError ? (
        <p role="alert" className="border-t bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {editError}
        </p>
      ) : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {total === 0 ? 'Sin registros' : `Mostrando ${formatInt(from)}–${formatInt(to)} de ${formatInt(total)}`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="records-page-size" className="text-sm">
              Por página
            </Label>
            <Select value={String(params.pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger id="records-page-size" className="h-10 w-24 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)} className="min-h-10 text-base">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <nav className="flex items-center gap-1" aria-label="Paginación">
            <Button variant="outline" size="icon-lg" className="size-10" onClick={() => onPageChange(1)} disabled={params.page <= 1} aria-label="Primera página">
              <ChevronsLeft aria-hidden />
            </Button>
            <Button variant="outline" size="icon-lg" className="size-10" onClick={() => onPageChange(params.page - 1)} disabled={params.page <= 1} aria-label="Página anterior">
              <ChevronLeft aria-hidden />
            </Button>
            <span className="px-2 text-sm tabular-nums">
              Página {formatInt(params.page)} de {formatInt(pageCount)}
            </span>
            <Button variant="outline" size="icon-lg" className="size-10" onClick={() => onPageChange(params.page + 1)} disabled={params.page >= pageCount} aria-label="Página siguiente">
              <ChevronRight aria-hidden />
            </Button>
            <Button variant="outline" size="icon-lg" className="size-10" onClick={() => onPageChange(pageCount)} disabled={params.page >= pageCount} aria-label="Última página">
              <ChevronsRight aria-hidden />
            </Button>
          </nav>
        </div>
      </footer>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Eliminar este registro"
        destructive
        confirmLabel="Eliminar registro"
        pending={remove.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          await remove.mutateAsync({ id: toDelete.id, layerId: layer.id });
          setToDelete(null);
        }}
        description={
          toDelete ? (
            <div className="space-y-2">
              <p>
                Se eliminará el registro {toDelete.roleId ? `del rol ${toDelete.roleId} ` : ''}de la capa "{layer.name}", con sus comentarios y adjuntos. Esta acción no se puede deshacer.
              </p>
              {toDelete.numberAssignedAt ? <p className="text-amber-900">Este registro tiene un número asignado por la plataforma: solo un administrador puede eliminarlo desde su panel, indicando el motivo.</p> : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}
