import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { FilterOptions, LayerWithCount } from '@/shared/types';
import { FiltersPanel } from './FiltersPanel';

const layer: LayerWithCount = {
  id: 3,
  slug: 'recepcion-final',
  name: 'Recepción Final',
  department: 'edificacion',
  hasRole: true,
  fields: [
    { key: 'n_recepcion', label: 'N° Recepción', type: 'autonumber', required: false, options: {} },
    { key: 'estado', label: 'Estado', type: 'string', required: false, options: {} },
    { key: 'direccion', label: 'Dirección', type: 'string', required: false, options: {} },
  ],
  uniqueKeys: [],
  addressFieldKey: 'direccion',
  heatmapFieldKey: null,
  icon: 'check',
  iconColor: '#10b981',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  recordCount: 10,
  numberedRecordCount: 0,
};

const options: FilterOptions = { estado: ['', 'Aprobado', 'Rechazado'], direccion: 'text' };

describe('FiltersPanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(options), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup(initial: { filters?: Record<string, string[]>; loc?: 'none' | 'approx' | null; num?: 'with' | 'without' | null } = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <FiltersPanel layer={layer} filters={initial.filters ?? {}} loc={initial.loc ?? null} num={initial.num ?? null} onApply={onApply} onClose={onClose} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    return { onApply, onClose };
  }

  it('muestra lista de valores con "(Vacío)", un input de prefijo y filtros de ubicación y correlativo', async () => {
    setup();
    expect(await screen.findByLabelText('(Vacío)')).toBeInTheDocument();
    expect(screen.getByLabelText('Aprobado')).toBeInTheDocument();
    expect(screen.getByLabelText('Empieza con…')).toBeInTheDocument();
    expect(screen.getByLabelText('Sin coordenadas (solo en la tabla)')).toBeInTheDocument();
    expect(screen.getByLabelText('Sin número')).toBeInTheDocument();
  });

  it('aplica los filtros elegidos', async () => {
    const { onApply } = setup();
    fireEvent.click(await screen.findByLabelText('Aprobado'));
    fireEvent.click(screen.getByLabelText('(Vacío)'));
    fireEvent.change(screen.getByLabelText('Empieza con…'), { target: { value: 'Av.' } });
    fireEvent.click(screen.getByLabelText('Ubicación aproximada por dirección'));
    fireEvent.click(screen.getByLabelText('Sin número'));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(onApply).toHaveBeenCalledWith({ estado: ['Aprobado', ''], direccion: ['Av.'] }, 'approx', 'without');
  });

  it('"Limpiar" aplica el estado vacío', async () => {
    const { onApply } = setup({ filters: { estado: ['Aprobado'] }, loc: 'none' });
    expect(await screen.findByLabelText('Aprobado')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(onApply).toHaveBeenCalledWith({}, null, null);
  });
});
