'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardList, FilterX } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import {
  auditActionLabels,
  auditActions,
  auditEntities,
  auditEntityLabels,
  type AuditAction,
  type AuditEntity,
} from '@/shared/constants';
import type { AuditLogDto, Paginated, UsersList } from '@/shared/types';
import { useLayerOptions } from './AuditAdmin';
import { Paginator } from './Paginator';

const PAGE_SIZE = 20;
const ALL = 'all';

/** Colores por acción (§10.3): CREATE verde, UPDATE azul, DELETE rojo, IMPORT púrpura, REVERT naranjo, ASSIGN_NUMBER morado institucional. */
const actionStyles: Record<AuditAction, string> = {
  CREATE: 'bg-green-100 text-green-900 border-green-200',
  UPDATE: 'bg-blue-100 text-blue-900 border-blue-200',
  DELETE: 'bg-red-100 text-red-900 border-red-200',
  IMPORT: 'bg-purple-100 text-purple-900 border-purple-200',
  REVERT: 'bg-orange-100 text-orange-900 border-orange-200',
  ASSIGN_NUMBER: 'bg-primary-soft text-primary-dark border-primary/30',
};

export function ActionBadge({ action }: { action: AuditAction }) {
  return (
    <Badge variant="outline" className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', actionStyles[action])}>
      {auditActionLabels[action]}
    </Badge>
  );
}

function meta(log: AuditLogDto): Record<string, unknown> {
  return (log.metadata ?? {}) as Record<string, unknown>;
}

/** "Capa #3", "Registro #120", "Rol 00050-00001", "Usuario mperez@…", "Polígono #7", "Adjunto", "Importación" (§10.3). */
export function describeEntity(log: AuditLogDto): string {
  const m = meta(log);
  switch (log.entityType) {
    case 'LAYER':
      return `Capa #${log.entityId}${typeof m.name === 'string' ? ` · ${m.name}` : ''}`;
    case 'RECORD':
      return `Registro #${log.entityId}`;
    case 'ROLE':
      return `Rol ${log.entityId}`;
    case 'ROLE_OPERATION':
      return `Operación de rol #${log.entityId}`;
    case 'USER':
      return `Usuario${typeof m.email === 'string' ? ` ${m.email}` : ''}`;
    case 'POLYGON':
      return `Polígono #${log.entityId}${typeof m.kind === 'string' ? ` (${m.kind})` : ''}`;
    case 'ATTACHMENT':
      return `Adjunto${typeof m.title === 'string' ? ` "${m.title}"` : ''}`;
    case 'IMPORT':
      return 'Importación';
    default:
      return String(log.entityType);
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Detalle del metadata: para UPDATE con before/after muestra una tabla clave → antes → después; el resto como JSON. */
function LogDetails({ log }: { log: AuditLogDto }) {
  const m = meta(log);
  const { before, after, ...rest } = m;
  const hasDiff = isRecord(before) && isRecord(after);
  const keys = hasDiff ? Array.from(new Set([...Object.keys(before), ...Object.keys(after)])) : [];

  if (!hasDiff && Object.keys(rest).length === 0) {
    return <p className="text-sm text-muted-foreground">Sin detalles adicionales.</p>;
  }

  return (
    <div className="space-y-3">
      {hasDiff ? (
        keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Se guardó sin cambios en los campos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Campo</th>
                <th className="py-1 pr-3 font-medium">Antes</th>
                <th className="py-1 font-medium">Después</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-t align-top">
                  <td className="py-1.5 pr-3 font-medium">{k}</td>
                  <td className="py-1.5 pr-3 break-all text-red-900 line-through decoration-red-400">{formatValue(before[k])}</td>
                  <td className="py-1.5 break-all text-green-900">{formatValue(after[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
      {Object.keys(rest).length > 0 ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-3 text-xs break-all whitespace-pre-wrap">{JSON.stringify(rest, null, 2)}</pre>
      ) : null}
    </div>
  );
}

type Filters = {
  action: AuditAction | typeof ALL;
  entityType: AuditEntity | typeof ALL;
  layerId: string;
  userId: string;
  from: string;
  to: string;
};

const emptyFilters: Filters = { action: ALL, entityType: ALL, layerId: ALL, userId: ALL, from: '', to: '' };

/** Lista de logs con filtros (acción, entidad, capa, usuario, fechas) y paginación real de 20 (§10.3). */
export function AuditLogList() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const layers = useLayerOptions();
  const users = useQuery({
    queryKey: queryKeys.users.list({ limit: 100, offset: 0, for: 'audit' }),
    queryFn: () => api<UsersList>('/api/admin/users', { query: { limit: 100, offset: 0 } }),
    staleTime: 60_000,
  });

  const params = {
    page,
    pageSize: PAGE_SIZE,
    action: filters.action === ALL ? undefined : filters.action,
    entityType: filters.entityType === ALL ? undefined : filters.entityType,
    layerId: filters.layerId === ALL ? undefined : Number(filters.layerId),
    userId: filters.userId === ALL ? undefined : filters.userId,
    from: filters.from || undefined,
    to: filters.to || undefined,
  };

  const logs = useQuery({
    queryKey: queryKeys.audit.logs(params),
    queryFn: () => api<Paginated<AuditLogDto>>('/api/audit/logs', { query: params }),
    placeholderData: keepPreviousData,
  });

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const hasFilters = JSON.stringify(filters) !== JSON.stringify(emptyFilters);
  const dateError = filters.from && filters.to && filters.from > filters.to ? 'La fecha "Desde" debe ser anterior a "Hasta".' : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1.5">
            <Label htmlFor="f-action" className="text-sm">
              Acción
            </Label>
            <Select value={filters.action} onValueChange={(v) => update('action', v as Filters['action'])}>
              <SelectTrigger id="f-action" className="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas</SelectItem>
                {auditActions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {auditActionLabels[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-entity" className="text-sm">
              Qué se modificó
            </Label>
            <Select value={filters.entityType} onValueChange={(v) => update('entityType', v as Filters['entityType'])}>
              <SelectTrigger id="f-entity" className="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todo</SelectItem>
                {auditEntities.map((e) => (
                  <SelectItem key={e} value={e}>
                    {auditEntityLabels[e]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-layer" className="text-sm">
              Capa
            </Label>
            <Select value={filters.layerId} onValueChange={(v) => update('layerId', v)}>
              <SelectTrigger id="f-layer" className="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas las capas</SelectItem>
                {(layers.data ?? []).map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-user" className="text-sm">
              Usuario
            </Label>
            <Select value={filters.userId} onValueChange={(v) => update('userId', v)}>
              <SelectTrigger id="f-user" className="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos los usuarios</SelectItem>
                {(users.data?.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} · {u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-from" className="text-sm">
              Desde
            </Label>
            <Input id="f-from" type="date" value={filters.from} onChange={(e) => update('from', e.target.value)} className="h-11 text-base" max={filters.to || undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-to" className="text-sm">
              Hasta
            </Label>
            <Input id="f-to" type="date" value={filters.to} onChange={(e) => update('to', e.target.value)} className="h-11 text-base" min={filters.from || undefined} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {dateError ? <p className="text-sm font-medium text-destructive">{dateError}</p> : <span />}
          {hasFilters ? (
            <Button type="button" variant="ghost" className="h-11 text-base" onClick={() => { setFilters(emptyFilters); setPage(1); }}>
              <FilterX aria-hidden /> Limpiar filtros
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
        {logs.isPending ? (
          <LoadingState rows={6} label="Cargando auditoría…" />
        ) : logs.isError ? (
          <ErrorState title="No se pudo cargar la auditoría" message={errorMessage(logs.error)} onRetry={() => void logs.refetch()} />
        ) : logs.data.data.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={hasFilters ? 'No hay movimientos con estos filtros' : 'Todavía no hay movimientos registrados'}
            description={hasFilters ? 'Prueba ampliando el rango de fechas o quitando algún filtro.' : 'Aquí aparecerá cada cambio que se haga en la plataforma.'}
          />
        ) : (
          <div className={logs.isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <Table className="text-base">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="h-12 text-sm">Fecha</TableHead>
                  <TableHead className="h-12 text-sm">Acción</TableHead>
                  <TableHead className="h-12 text-sm">Qué se modificó</TableHead>
                  <TableHead className="h-12 text-sm">Quién</TableHead>
                  <TableHead className="h-12 text-sm">Detalles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.data.map((log) => (
                  <TableRow key={log.id} className="align-top">
                    <TableCell className="py-3 whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                    <TableCell className="py-3">
                      <ActionBadge action={log.action} />
                    </TableCell>
                    <TableCell className="py-3">
                      <p>{describeEntity(log)}</p>
                      {log.layerId && log.entityType !== 'LAYER' ? (
                        <p className="text-sm text-muted-foreground">
                          Capa: {layers.data?.find((l) => l.id === log.layerId)?.name ?? `#${log.layerId}`}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="break-all">{log.userEmail ?? log.userId}</span>
                    </TableCell>
                    <TableCell className="py-3">
                      <details className="group">
                        <summary className="inline-flex h-11 cursor-pointer items-center rounded-md px-3 text-base font-medium text-primary hover:bg-primary-soft">
                          Ver detalles
                        </summary>
                        <div className="mt-2 max-w-xl">
                          <LogDetails log={log} />
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {logs.data ? <Paginator page={page} pageSize={PAGE_SIZE} total={logs.data.total} onPageChange={setPage} noun="movimientos" disabled={logs.isFetching} /> : null}
    </div>
  );
}
