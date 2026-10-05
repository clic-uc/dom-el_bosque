/** Claves de TanStack Query (§2). Invalidar siempre por prefijo: `queryKeys.layers.all`, etc. */
export const queryKeys = {
  session: ['session'] as const,
  layers: {
    all: ['layers'] as const,
    list: () => ['layers', 'list'] as const,
    detail: (id: number) => ['layers', 'detail', id] as const,
    features: (id: number, params?: unknown) => ['layers', 'features', id, params ?? null] as const,
    featuresAll: (id: number) => ['layers', 'features', id] as const,
    records: (id: number, params?: unknown) => ['layers', 'records', id, params ?? null] as const,
    recordsAll: (id: number) => ['layers', 'records', id] as const,
    filters: (id: number) => ['layers', 'filters', id] as const,
    duplicates: (id: number, keys: string[]) => ['layers', 'duplicates', id, keys.join(',')] as const,
    counters: (id: number) => ['layers', 'counters', id] as const,
  },
  records: {
    all: ['records'] as const,
    detail: (id: number) => ['records', 'detail', id] as const,
  },
  roles: {
    all: ['roles'] as const,
    search: (q: string, limit?: number) => ['roles', 'search', q, limit ?? null] as const,
    detail: (roleId: string) => ['roles', 'detail', roleId] as const,
    records: (roleId: string, includeLineage: boolean) => ['roles', 'records', roleId, includeLineage] as const,
  },
  roleOperations: {
    all: ['roleOperations'] as const,
    list: (params?: unknown) => ['roleOperations', 'list', params ?? null] as const,
  },
  geocode: {
    query: (q: string) => ['geocode', q] as const,
  },
  imports: {
    all: ['imports'] as const,
    list: (params?: unknown) => ['imports', 'list', params ?? null] as const,
    detail: (id: string) => ['imports', 'detail', id] as const,
    rows: (id: string, params?: unknown) => ['imports', 'rows', id, params ?? null] as const,
    rowsAll: (id: string) => ['imports', 'rows', id] as const,
    removals: (id: string, params?: unknown) => ['imports', 'removals', id, params ?? null] as const,
  },
  polygons: {
    all: ['polygons'] as const,
    kind: (kind: string) => ['polygons', 'kind', kind] as const,
    detail: (id: number) => ['polygons', 'detail', id] as const,
    stats: (kind: string, layerId: number) => ['polygons', 'stats', kind, layerId] as const,
  },
  attachments: {
    all: ['attachments'] as const,
    list: (entityType: string, entityId: string) => ['attachments', entityType, entityId] as const,
  },
  audit: {
    all: ['audit'] as const,
    logs: (params?: unknown) => ['audit', 'logs', params ?? null] as const,
  },
  users: {
    all: ['users'] as const,
    list: (params?: unknown) => ['users', 'list', params ?? null] as const,
  },
};
