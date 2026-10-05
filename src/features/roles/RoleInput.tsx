'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useRoleDetail, useRoleSearch } from '@/features/map/hooks';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { tryNormalizeRoleId } from '@/shared/role-id';
import type { RoleDto } from '@/shared/types';

/**
 * Input de Rol SII (§10.2): máscara `00000-00000`, validación en vivo, sugerencias de `GET /api/roles?q=`
 * y badge "Rol existente" / "Rol nuevo" / "No vigente". Al salir del campo completa los ceros a la izquierda.
 */
export type RoleInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Se llama cuando el valor normalizado corresponde a un rol existente (o null si no existe / inválido). */
  onRoleResolved?: (role: RoleDto | null) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
  'aria-describedby'?: string;
};

/** Deja solo dígitos y un guion; inserta el guion tras 5 dígitos; máximo 5 dígitos por lado. */
export function maskRoleInput(raw: string): string {
  const unified = raw.replace(/[–—−_/\s]+/g, '-');
  const hyphenAt = unified.indexOf('-');
  const digitsOnly = (s: string) => s.replace(/\D+/g, '');
  if (hyphenAt === -1) {
    const d = digitsOnly(unified);
    if (d.length <= 5) return d;
    return `${d.slice(0, 5)}-${d.slice(5, 10)}`;
  }
  const left = digitsOnly(unified.slice(0, hyphenAt)).slice(0, 5);
  const right = digitsOnly(unified.slice(hyphenAt + 1)).slice(0, 5);
  return `${left}-${right}`;
}

export type RoleStatus = 'idle' | 'incomplete' | 'invalid' | 'checking' | 'existing' | 'new' | 'superseded';

export function RoleStatusBadge({ status, className }: { status: RoleStatus; className?: string }) {
  if (status === 'existing') {
    return (
      <Badge
        className={cn('rounded-md bg-secondary-soft text-secondary-strong', className)}
        variant="outline"
      >
        Rol existente
      </Badge>
    );
  }
  if (status === 'new') {
    return (
      <Badge className={cn('rounded-md', className)} variant="outline">
        Rol nuevo
      </Badge>
    );
  }
  if (status === 'superseded') {
    return (
      <Badge
        className={cn('rounded-md border-amber-300 bg-amber-50 text-amber-900', className)}
        variant="outline"
      >
        No vigente
      </Badge>
    );
  }
  return null;
}

export function RoleInput({
  value,
  onChange,
  onRoleResolved,
  disabled,
  id,
  placeholder = '00000-00000',
  className,
  'aria-describedby': describedBy,
}: RoleInputProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-rol`;
  const statusId = `${autoId}-estado`;
  const listId = `${autoId}-sugerencias`;
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [rawActiveIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => tryNormalizeRoleId(value), [value]);
  const normalized = parsed.ok ? parsed.value : null;
  const complete = /^\d{1,5}-\d{1,5}$/.test(value.trim());

  const detail = useRoleDetail(normalized, complete);
  const search = useRoleSearch(value, 6, focused && !dismissed && value.trim().length >= 2);
  const suggestions = useMemo(
    () => (search.data ?? []).filter((r) => r.id !== normalized || !detail.data),
    [search.data, normalized, detail.data],
  );
  const open = focused && !dismissed && suggestions.length > 0 && !disabled;
  // Si la lista cambió y el índice ya no existe, no hay opción activa (sin efecto ni render extra).
  const activeIndex = rawActiveIndex < suggestions.length ? rawActiveIndex : -1;

  let status: RoleStatus = 'idle';
  if (value.trim() === '') status = 'idle';
  else if (!parsed.ok) status = 'invalid';
  else if (!complete) status = 'incomplete';
  else if (detail.isPending) status = 'checking';
  else if (detail.data) status = detail.data.vigente ? 'existing' : 'superseded';
  else if (detail.error instanceof ApiError && detail.error.status === 404) status = 'new';

  // Avisamos al contenedor solo cuando cambia el resultado (rol existente o null).
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (!onRoleResolved) return;
    const key =
      status === 'existing' || status === 'superseded'
        ? `role:${detail.data!.id}`
        : status === 'checking' || status === 'incomplete'
          ? null
          : 'none';
    if (key === null || key === lastEmitted.current) return;
    lastEmitted.current = key;
    onRoleResolved(key === 'none' ? null : detail.data!);
  }, [status, detail.data, onRoleResolved]);

  function pick(role: RoleDto) {
    onChange(role.id);
    setDismissed(true);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' && suggestions.length) setDismissed(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      pick(suggestions[activeIndex]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDismissed(true);
    }
  }

  const showError = status === 'invalid' || (touched && status === 'incomplete' && !focused);
  const role = detail.data;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Popover open={open}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              ref={inputRef}
              id={inputId}
              value={value}
              inputMode="numeric"
              autoComplete="off"
              placeholder={placeholder}
              disabled={disabled}
              aria-invalid={showError || undefined}
              aria-describedby={[statusId, describedBy].filter(Boolean).join(' ')}
              aria-autocomplete="list"
              aria-controls={open ? listId : undefined}
              aria-expanded={open}
              aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              role="combobox"
              className="h-11 pr-10 font-mono text-base tracking-wide"
              onChange={(e) => {
                setDismissed(false);
                setActiveIndex(-1);
                onChange(maskRoleInput(e.target.value));
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                setTouched(true);
                if (parsed.ok && parsed.value && parsed.value !== value) onChange(parsed.value);
              }}
              onKeyDown={onKeyDown}
            />
            {status === 'checking' || search.isFetching ? (
              <Loader2
                className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-72 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (e.target === inputRef.current) e.preventDefault();
          }}
        >
          <ul id={listId} role="listbox" aria-label="Roles sugeridos" className="max-h-64 overflow-y-auto">
            {suggestions.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={cn(
                  'flex min-h-11 cursor-pointer flex-col justify-center rounded-sm px-3 py-1.5',
                  i === activeIndex && 'bg-accent text-accent-foreground',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pick(r)}
              >
                <span className="flex items-center gap-2 font-mono text-base">
                  {r.id}
                  {!r.vigente ? <RoleStatusBadge status="superseded" /> : null}
                </span>
                {r.address ? (
                  <span className="truncate text-sm text-muted-foreground">{r.address}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      <div id={statusId} className="min-h-5 text-sm" aria-live="polite">
        {showError ? (
          <p className="text-destructive">
            Escribe el rol como 00000-00000, solo con números (por ejemplo 4631-30).
          </p>
        ) : status === 'checking' ? (
          <p className="text-muted-foreground">Buscando el rol en el padrón…</p>
        ) : status === 'existing' || status === 'superseded' ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RoleStatusBadge status={status} />
            {role?.address ? <span className="text-muted-foreground">{role.address}</span> : null}
            {status === 'superseded' && role?.supersededAt ? (
              <span className="text-amber-900">
                No vigente desde el {formatDate(role.supersededAt)}
                {role.resultRoleIds?.length ? `; reemplazado por ${role.resultRoleIds.join(', ')}` : ''}.
              </span>
            ) : null}
          </div>
        ) : status === 'new' ? (
          <div className="flex flex-wrap items-center gap-2">
            <RoleStatusBadge status="new" />
            <span className="text-muted-foreground">
              Este rol no está en el padrón; se creará al guardar.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
