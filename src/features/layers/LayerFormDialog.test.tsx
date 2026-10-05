import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActorProvider } from '@/features/auth/actor-context';
import type { CurrentUser } from '@/shared/types';
import { LayerFormDialog } from './LayerFormDialog';

const actor: CurrentUser = { id: 'u1', name: 'Editora', email: 'editora@elbosque.cl', role: 'editor', mustChangePassword: false };

function renderCreate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ActorProvider actor={actor}>
          <LayerFormDialog open onOpenChange={() => {}} mode="create" />
        </ActorProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn();

beforeAll(() => {
  // Radix usa APIs que jsdom no implementa
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe('LayerFormDialog (modo crear)', () => {
  it('genera la clave interna en snake_case al escribir el nombre del campo', async () => {
    renderCreate();
    expect(screen.getByRole('heading', { name: 'Nueva capa' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /agregar campo/i }));
    const labelInput = await screen.findByLabelText(/nombre del campo/i);
    fireEvent.change(labelInput, { target: { value: 'N° Permiso' } });

    await waitFor(() => expect(screen.getByText('n_permiso')).toBeInTheDocument());

    // un segundo campo con el mismo nombre recibe sufijo
    fireEvent.click(screen.getByRole('button', { name: /agregar campo/i }));
    const inputs = await screen.findAllByLabelText(/nombre del campo/i);
    fireEvent.change(inputs[1]!, { target: { value: 'N° Permiso' } });
    await waitFor(() => expect(screen.getByText('n_permiso_2')).toBeInTheDocument());
  });

  it('no deja guardar sin nombre ni departamento y no llama a la API', async () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear capa/i }));

    expect(await screen.findByText('Escribe el nombre de la capa')).toBeInTheDocument();
    // el texto aparece como placeholder del selector y como mensaje de error
    expect(await screen.findAllByText('Elige un departamento')).toHaveLength(2);
    expect(screen.getByText(/hay datos por corregir/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('muestra el aviso de campos únicos y la opción de rol por defecto', async () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /agregar campo/i }));
    const labelInput = await screen.findByLabelText(/nombre del campo/i);
    fireEvent.change(labelInput, { target: { value: 'Dirección' } });
    expect(await screen.findByText(/sin campos únicos, reimportar un archivo/i)).toBeInTheDocument();
    expect(screen.getByText(/junto con el rol, identifican a un registro/i)).toBeInTheDocument();
  });
});
