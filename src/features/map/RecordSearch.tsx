'use client';

import { Loader2, MapPin, MapPinOff, Navigation, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { RoleStatusBadge } from '@/features/roles/RoleInput';
import { formatFieldValue } from '@/lib/format';
import { cn } from '@/lib/utils';
import { looksLikeRoleId } from '@/shared/role-id';
import { normalizeText } from '@/shared/text';
import type { GeocodeResult, LayerWithCount, RecordListItem, RoleDto } from '@/shared/types';
import { errorMessage } from '@/lib/api';
import { geocodeQueryOptions, useRecordSearch, useRoleSearch } from './hooks';
import type { MapView } from './url-state';

type Props = {
  workingLayer: LayerWithCount | null;
  /** Texto de la URL (`q`). En vista tabla también filtra la tabla. */
  value: string;
  view: MapView;
  onQueryChange: (q: string) => void;
  onSelectRecord: (record: RecordListItem) => void;
  onSelectRole: (roleId: string) => void;
  onGoToAddress: (result: GeocodeResult) => void;
  className?: string;
};

type Item =
  | { kind: 'record'; record: RecordListItem }
  | { kind: 'role'; role: RoleDto }
  | { kind: 'address'; text: string };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function matchingField(record: RecordListItem, layer: LayerWithCount, q: string): string {
  const nq = normalizeText(q);
  let fallback = '';
  for (const f of layer.fields) {
    const text = formatFieldValue(record.attributes[f.key], f.type);
    if (!text) continue;
    if (!fallback) fallback = `${f.label}: ${text}`;
    if (nq && normalizeText(text).includes(nq)) return `${f.label}: ${text}`;
  }
  return fallback || `Registro #${record.id}`;
}

function looksLikeAddress(q: string): boolean {
  return /[a-záéíóúñ]{3,}/i.test(q) && q.trim().length >= 5;
}

/** Barra de búsqueda (§8.6): registros de la capa de trabajo, roles y "Ir a dirección". */
export function RecordSearch({
  workingLayer,
  value,
  view,
  onQueryChange,
  onSelectRecord,
  onSelectRole,
  onGoToAddress,
  className,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [rawActive, setActive] = useState(-1);
  const [geocoding, setGeocoding] = useState(false);
  const queryClient = useQueryClient();
  const debounced = useDebounced(text, 250);

  // La URL manda: si cambia desde fuera (cambio de capa, limpiar), se refleja aquí (ajuste durante el render).
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }

  // En vista tabla el texto filtra la tabla del servidor.
  useEffect(() => {
    if (view === 'table' && debounced.trim() !== value) onQueryChange(debounced.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia el texto con debounce
  }, [debounced, view]);

  const term = debounced.trim();
  const searching = focused && !dismissed && term.length >= 2;
  const records = useRecordSearch(workingLayer?.id ?? null, term, searching);
  const roles = useRoleSearch(term, 5, searching);
  async function goToAddress(q: string) {
    setGeocoding(true);
    try {
      const result = await queryClient.fetchQuery(geocodeQueryOptions(q));
      if (result) {
        onGoToAddress(result);
        setDismissed(true);
      } else {
        toast.error('No encontramos esa dirección en la comuna. Revisa la calle y el número.');
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGeocoding(false);
    }
  }

  const roleFirst = looksLikeRoleId(term);
  const items = useMemo<Item[]>(() => {
    const rec: Item[] = (records.data?.data ?? []).map((record) => ({ kind: 'record', record }));
    const rol: Item[] = (roles.data ?? []).map((role) => ({ kind: 'role', role }));
    const addr: Item[] = rol.length === 0 && looksLikeAddress(term) ? [{ kind: 'address', text: term }] : [];
    return roleFirst ? [...rol, ...rec, ...addr] : [...rec, ...rol, ...addr];
  }, [records.data, roles.data, term, roleFirst]);

  const groups = useMemo(() => {
    const out: { title: string; items: { item: Item; index: number }[] }[] = [];
    const push = (title: string, kind: Item['kind']) => {
      const list = items.map((item, index) => ({ item, index })).filter((x) => x.item.kind === kind);
      if (list.length) out.push({ title, items: list });
    };
    if (roleFirst) {
      push('Roles', 'role');
      push(workingLayer ? `Registros de ${workingLayer.name}` : 'Registros', 'record');
    } else {
      push(workingLayer ? `Registros de ${workingLayer.name}` : 'Registros', 'record');
      push('Roles', 'role');
    }
    push('Dirección', 'address');
    return out;
  }, [items, roleFirst, workingLayer]);

  const loading = records.isFetching || roles.isFetching;
  const open = searching && (items.length > 0 || loading || term.length >= 2);
  // Si la lista cambió y el índice ya no existe, no hay opción activa.
  const active = rawActive < items.length ? rawActive : -1;

  function select(item: Item) {
    setDismissed(true);
    if (item.kind === 'record') onSelectRecord(item.record);
    else if (item.kind === 'role') onSelectRole(item.role.id);
    else void goToAddress(item.text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setDismissed(true);
      return;
    }
    if (!open) {
      if (e.key === 'ArrowDown') setDismissed(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
    } else if (e.key === 'Enter') {
      if (active >= 0 && items[active]) {
        e.preventDefault();
        select(items[active]!);
      } else if (items[0]) {
        e.preventDefault();
        select(items[0]);
      }
    }
  }

  return (
    <div className={cn('relative w-full max-w-xl', className)}>
      <Popover open={open}>
        <PopoverAnchor asChild>
          <div className="relative">
            <label htmlFor={`${id}-input`} className="sr-only">
              Buscar por rol, dirección o cualquier campo
            </label>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              id={`${id}-input`}
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              value={text}
              placeholder="Buscar por rol, dirección o cualquier campo…"
              className="h-11 pr-10 pl-10 text-base"
              onChange={(e) => {
                setText(e.target.value);
                setDismissed(false);
                setActive(-1);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
            />
            {text ? (
              <button
                type="button"
                className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label="Borrar búsqueda"
                onClick={() => {
                  setText('');
                  if (value) onQueryChange('');
                  inputRef.current?.focus();
                }}
              >
                {geocoding ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <X className="size-4" aria-hidden />
                )}
              </button>
            ) : null}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="z-(--z-index-toolbar) w-(--radix-popover-trigger-width) min-w-80 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (e.target === inputRef.current) e.preventDefault();
          }}
        >
          <div
            id={listId}
            role="listbox"
            aria-label="Resultados de la búsqueda"
            className="max-h-[60dvh] overflow-y-auto"
          >
            {groups.map((g) => (
              <div key={g.title} role="group" aria-label={g.title}>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {g.title}
                </p>
                {g.items.map(({ item, index }) => {
                  const selected = index === active;
                  const base = cn(
                    'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-left',
                    selected && 'bg-accent text-accent-foreground',
                  );
                  if (item.kind === 'record') {
                    const r = item.record;
                    return (
                      <div
                        key={`r${r.id}`}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={selected}
                        className={base}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => select(item)}
                      >
                        {r.lat === null ? (
                          <MapPinOff
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-label="Sin coordenadas"
                          />
                        ) : (
                          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-base">{r.roleId ?? 'Sin rol'}</span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {workingLayer ? matchingField(r, workingLayer, term) : `Registro #${r.id}`}
                          </span>
                        </span>
                      </div>
                    );
                  }
                  if (item.kind === 'role') {
                    const role = item.role;
                    return (
                      <div
                        key={`o${role.id}`}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={selected}
                        className={base}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => select(item)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 font-mono text-base">
                            {role.id}
                            {!role.vigente ? <RoleStatusBadge status="superseded" /> : null}
                          </span>
                          {role.address ? (
                            <span className="block truncate text-sm text-muted-foreground">
                              {role.address}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key="addr"
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={selected}
                      className={base}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => select(item)}
                    >
                      <Navigation className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="text-base">Ir a “{item.text}”</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {loading ? (
              <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Buscando…
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {workingLayer
                  ? 'Sin resultados. Prueba con el rol, parte de la dirección o un valor de la capa.'
                  : 'Elige una capa de trabajo para buscar registros.'}
              </p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
