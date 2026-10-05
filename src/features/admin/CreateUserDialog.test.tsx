import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CreateUserDialog } from './CreateUserDialog';
import { generatePassword } from './password';

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <CreateUserDialog open onOpenChange={() => undefined} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('CreateUserDialog', () => {
  beforeAll(() => {
    // Radix RadioGroup mide su tamaño con ResizeObserver, que jsdom no implementa.
    if (!('ResizeObserver' in globalThis)) {
      class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    }
  });

  it('rechaza una contraseña corta sin llamar a la API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderDialog();

    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'María Pérez' } });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'mperez@test.cl' } });
    fireEvent.change(screen.getByLabelText('Contraseña temporal'), { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByText('La contraseña debe tener al menos 10 caracteres')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('muestra los roles con una descripción de qué puede hacer cada uno y preselecciona Visor', () => {
    renderDialog();
    expect(screen.getByRole('radio', { name: /Visor/ })).toBeChecked();
    expect(screen.getByText(/crear usuarios, cambiar roles/)).toBeInTheDocument();
    expect(screen.getByText(/importar archivos/)).toBeInTheDocument();
  });

  it('"Generar" llena una contraseña de 16 caracteres y la muestra', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    const input = screen.getByLabelText('Contraseña temporal') as HTMLInputElement;
    await waitFor(() => expect(input.value).toHaveLength(16));
    expect(input.type).toBe('text');
  });
});

describe('generatePassword', () => {
  it('genera 16 caracteres legibles con mayúscula, minúscula, dígito y símbolo', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[#$%&*+\-=?!]/);
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });
});
