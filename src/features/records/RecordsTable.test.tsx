import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActorProvider } from '@/features/auth/actor-context';
import type { RecordsPageParams } from '@/features/map/hooks';
import type { CurrentUser, LayerWithCount, Paginated, RecordListItem } from '@/shared/types';
import { RecordsTable } from './RecordsTable';

const layer: LayerWithCount = {
  id: 7,
  slug: 'obras-menores',
  name: 'Obras Menores',
  department: 'edificacion',
  hasRole: true,
  fields: [
    { key: 'n_permiso', label: 'N° Permiso', type: 'autonumber', required: false, options: {} },
    { key: 'propietario', label: 'Propietario', type: 'string', required: false, options: {} },
    { key: 'superficie', label: 'Superficie', type: 'number', required: false, options: {} },
    { key: 'aprobado', label: 'Aprobado', type: 'boolean', required: false, options: {} },
  ],
  uniqueKeys: ['n_permiso'],
  addressFieldKey: null,
  heatmapFieldKey: null,
  icon: 'hammer',
  iconColor: '#3b82f6',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  recordCount: 120,
  numberedRecordCount: 0,
};

function record(id: number, extra: Partial<RecordListItem> = {}): RecordListItem {
  return {
    id,
    layerId: 7,
    roleId: `00050-${String(id).padStart(5, '0')}`,
    lat: -33.56,
    lon: -70.66,
    coordsSource: 'role',
    geocode: null,
    attributes: { n_permiso: 6000 + id, propietario: `Vecino ${id}`, superficie: 45.5, aprobado: true },
    comments: null,
    numberAssignedAt: null,
    numberAssignedBy: null,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-03-01T12:00:00.000Z',
    updatedAt: '2026-03-02T12:00:00.000Z',
    ...extra,
  };
}

const actor: CurrentUser = { id: 'u1', name: 'Editora Prueba', email: 'editora@example.com', role: 'editor', mustChangePassword: false };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const baseParams: RecordsPageParams = { page: 1, pageSize: 50, sort: 'updatedAt', dir: 'desc' };

function setup(params: Partial<RecordsPageParams> = {}, handlers: Partial<React.ComponentProps<typeof RecordsTable>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    layer,
    params: { ...baseParams, ...params },
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onSortChange: vi.fn(),
    onOpenRecord: vi.fn(),
    onOpenRole: vi.fn(),
    onViewOnMap: vi.fn(),
    ...handlers,
  };
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ActorProvider actor={actor}>
          <RecordsTable {...props} />
        </ActorProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return props;
}

describe('RecordsTable', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let lastUrl = '';
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) => {
      lastUrl = String(input);
      if (lastUrl.startsWith('/api/layers/7/records')) {
        const sp = new URL(lastUrl, 'http://x').searchParams;
        const page = Number(sp.get('page') ?? 1);
        const body: Paginated<RecordListItem> = {
          data: [record(page * 10 + 1), record(page * 10 + 2, { lat: null, lon: null, coordsSource: null, attributes: { propietario: 'Vecina sin permiso' } })],
          total: 120,
          page,
          pageSize: Number(sp.get('pageSize') ?? 50),
        };
        return jsonResponse(body);
      }
      if (lastUrl.startsWith('/api/records/') && init?.method === 'PATCH') {
        const id = Number(lastUrl.split('/').pop());
        return jsonResponse({ ...record(id), attributes: { ...record(id).attributes, ...(JSON.parse(String(init.body)) as { attributes?: Record<string, unknown> }).attributes } });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'No existe' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pide la página al servidor y la muestra con sus columnas', async () => {
    setup();
    expect(await screen.findByText('Vecino 11')).toBeInTheDocument();
    expect(lastUrl).toContain('/api/layers/7/records?');
    expect(lastUrl).toContain('page=1');
    expect(lastUrl).toContain('pageSize=50');
    expect(lastUrl).toContain('sort=updatedAt');
    expect(screen.getByRole('columnheader', { name: /Rol SII/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Propietario/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Acciones/ })).toBeInTheDocument();
    expect(screen.getByText('6.011')).toBeInTheDocument();
    expect(screen.getByText('Sin número')).toBeInTheDocument();
    expect(screen.getByLabelText('Sin coordenadas')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 1–50 de 120')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
  });

  it('pagina con los botones y el selector de tamaño', async () => {
    const props = setup({ page: 2 });
    await screen.findByText('Vecino 21');
    expect(screen.getByText('Mostrando 51–100 de 120')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(props.onPageChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Primera página' }));
    expect(props.onPageChange).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Última página' }));
    expect(props.onPageChange).toHaveBeenCalledWith(3);
  });

  it('ordena por columna y abre el registro o la ficha del rol', async () => {
    const props = setup();
    await screen.findByText('Vecino 11');
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Propietario/ })).getByRole('button'));
    expect(props.onSortChange).toHaveBeenCalledWith('attr:propietario', 'asc');
    fireEvent.click(screen.getByText('00050-00011'));
    expect(props.onOpenRole).toHaveBeenCalledWith('00050-00011');
    fireEvent.click(screen.getByText('Vecino 11'));
    expect(props.onOpenRecord).toHaveBeenCalledWith(11);
  });

  it('edita en línea y envía solo los campos cambiados', async () => {
    setup();
    await screen.findByText('Vecino 11');
    const row = screen.getByRole('row', { name: 'Registro 11' });
    fireEvent.click(within(row).getByRole('button', { name: /Editar/ }));
    const input = within(row).getByDisplayValue('Vecino 11');
    fireEvent.change(input, { target: { value: 'Vecina Nueva' } });
    fireEvent.click(within(row).getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, init]) => String(u) === '/api/records/11' && init?.method === 'PATCH')).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([u, init]) => String(u) === '/api/records/11' && init?.method === 'PATCH')!;
    expect(JSON.parse(String(patchCall[1]!.body))).toEqual({ attributes: { propietario: 'Vecina Nueva' } });
  });
});
