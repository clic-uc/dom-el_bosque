import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { maskRoleInput, RoleInput } from './RoleInput';

describe('maskRoleInput', () => {
  it('deja solo dígitos e inserta el guion tras 5 dígitos', () => {
    expect(maskRoleInput('0463100030')).toBe('04631-00030');
    expect(maskRoleInput('123456')).toBe('12345-6');
    expect(maskRoleInput('abc')).toBe('');
    expect(maskRoleInput('4631-30')).toBe('4631-30');
    expect(maskRoleInput('12/3')).toBe('12-3');
    expect(maskRoleInput('12345-678901')).toBe('12345-67890');
    expect(maskRoleInput('1-2-3')).toBe('1-23');
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function Harness({ onResolved }: { onResolved?: (r: unknown) => void }) {
  const [v, setV] = useState('');
  return (
    <>
      <label htmlFor="rol">Rol</label>
      <RoleInput id="rol" value={v} onChange={setV} onRoleResolved={onResolved} />
      <output data-testid="value">{v}</output>
    </>
  );
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('RoleInput', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/roles/')) {
        const id = decodeURIComponent(url.split('/').pop()!);
        if (id === '04631-00030') return jsonResponse({ id, lat: -33.5, lon: -70.6, address: 'Calle Falsa 123', supersededAt: null, vigente: true, recordCount: 2 });
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'El rol no existe' } }, 404);
      }
      if (url.startsWith('/api/roles?')) return jsonResponse([]);
      return jsonResponse(null, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('aplica la máscara mientras se escribe y normaliza al salir del campo', async () => {
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText('Rol');
    fireEvent.change(input, { target: { value: '463130' } });
    expect(screen.getByTestId('value').textContent).toBe('46313-0');
    fireEvent.change(input, { target: { value: '4631-30' } });
    expect(screen.getByTestId('value').textContent).toBe('4631-30');
    fireEvent.blur(input);
    expect(screen.getByTestId('value').textContent).toBe('04631-00030');
  });

  it('muestra "Rol existente" con la dirección del padrón y avisa al contenedor', async () => {
    const onResolved = vi.fn();
    renderWithProviders(<Harness onResolved={onResolved} />);
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: '04631-00030' } });
    await waitFor(() => expect(screen.getByText('Rol existente')).toBeInTheDocument());
    expect(screen.getByText('Calle Falsa 123')).toBeInTheDocument();
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ id: '04631-00030' })));
  });

  it('muestra "Rol nuevo" cuando el padrón responde 404', async () => {
    renderWithProviders(<Harness />);
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: '00001-00001' } });
    await waitFor(() => expect(screen.getByText('Rol nuevo')).toBeInTheDocument());
  });

  it('muestra el error de formato al salir con un rol incompleto', async () => {
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText('Rol');
    fireEvent.change(input, { target: { value: '12345-' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/Escribe el rol como 00000-00000/)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
