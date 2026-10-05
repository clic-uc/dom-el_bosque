import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AttachmentDto } from '@/shared/types';
import { AttachmentsList, attachmentIcon } from './AttachmentsList';

const link: AttachmentDto = {
  id: '11111111-1111-4111-8111-111111111111',
  entityType: 'polygon',
  entityId: '7',
  kind: 'link',
  title: 'Plano en Drive',
  url: 'https://drive.google.com/plano',
  storageKey: null,
  fileName: null,
  mimeType: null,
  sizeBytes: null,
  createdBy: 'u1',
  createdAt: '2026-03-12T15:00:00.000Z',
};

const file: AttachmentDto = {
  ...link,
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'file',
  title: 'Reglamento de copropiedad',
  url: null,
  storageKey: 'attachments/2222',
  fileName: 'reglamento.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 204800,
};

function mockFetch(payload: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
}

function renderList(canEdit: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AttachmentsList entityType="polygon" entityId="7" canEdit={canEdit} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('AttachmentsList', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renderiza enlaces (pestaña nueva) y archivos (descarga) con su fecha', async () => {
    const fetchSpy = mockFetch([link, file]);
    renderList(false);

    const linkEl = await screen.findByRole('link', { name: /Plano en Drive/ });
    expect(linkEl).toHaveAttribute('href', 'https://drive.google.com/plano');
    expect(linkEl).toHaveAttribute('target', '_blank');
    expect(linkEl).toHaveAttribute('rel', expect.stringContaining('noopener'));

    const fileEl = screen.getByRole('link', { name: /Reglamento de copropiedad/ });
    expect(fileEl).toHaveAttribute('href', `/api/attachments/${file.id}/download`);
    expect(screen.getByText(/reglamento\.pdf · 200 KB · agregado el 12-03-2026/)).toBeInTheDocument();

    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain('/api/attachments?');
    expect(url).toContain('entityType=polygon');
    expect(url).toContain('entityId=7');

    // visor: sin botones de edición
    expect(screen.queryByRole('button', { name: /Agregar enlace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
  });

  it('editor: muestra estado vacío con instrucciones y botones para agregar', async () => {
    mockFetch([]);
    renderList(true);
    expect(await screen.findByText('Sin documentos adjuntos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agregar enlace/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subir archivo/ })).toBeInTheDocument();
  });

  it('elige el ícono por tipo', () => {
    expect(attachmentIcon(link).label).toBe('Enlace');
    expect(attachmentIcon(file).label).toBe('PDF');
    expect(attachmentIcon({ kind: 'file', mimeType: 'image/png', fileName: 'foto.png' }).label).toBe('Imagen');
    expect(attachmentIcon({ kind: 'file', mimeType: 'application/octet-stream', fileName: 'plano.dwg' }).label).toBe('Plano');
    expect(attachmentIcon({ kind: 'file', mimeType: 'application/msword', fileName: 'doc.doc' }).label).toBe('Archivo');
  });
});
