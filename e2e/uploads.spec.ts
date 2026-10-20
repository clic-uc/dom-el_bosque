/**
 * Subidas grandes contra la app en modo producción (§5.5, §12.3). Las rutas de subida están fuera del `matcher` de
 * `proxy.ts`: con proxy, Next deja pasar solo los primeros 10 MB del cuerpo y un adjunto de 15 MB terminaba en 500.
 * Solo se ve con el servidor real, no en los tests de las rutas.
 */
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';

const MB = 1024 * 1024;

/** PDF de relleno del tamaño pedido: la cabecera `%PDF-` basta para la revisión de contenido. */
function pdfOf(bytes: number): Buffer {
  const head = Buffer.from('%PDF-1.4\n');
  return Buffer.concat([head, Buffer.alloc(bytes - head.length, 0x20)]);
}

async function firstPolygonId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/polygons?kind=villa');
  expect(res.status()).toBe(200);
  const { features } = (await res.json()) as { features: { id: number }[] };
  expect(features.length).toBeGreaterThan(0);
  return String(features[0]!.id);
}

test.describe('subidas grandes', () => {
  test('un adjunto de 15 MB se guarda y se descarga completo', async ({ editorRequest }) => {
    const entityId = await firstPolygonId(editorRequest);
    const file = pdfOf(15 * MB);
    const res = await editorRequest.post('/api/attachments', {
      multipart: {
        title: 'Plano de 15 MB (e2e)',
        entityType: 'polygon',
        entityId,
        file: { name: 'plano-15mb.pdf', mimeType: 'application/pdf', buffer: file },
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { id, sizeBytes } = (await res.json()) as { id: string; sizeBytes: number };
    expect(sizeBytes).toBe(file.length);

    const download = await editorRequest.get(`/api/attachments/${id}/download`);
    expect(download.status()).toBe(200);
    expect((await download.body()).equals(file)).toBe(true);

    expect((await editorRequest.delete(`/api/attachments/${id}`)).status()).toBe(204);
  });

  test('un adjunto de 21 MB recibe 400 con el máximo', async ({ editorRequest }) => {
    const entityId = await firstPolygonId(editorRequest);
    const res = await editorRequest.post('/api/attachments', {
      multipart: {
        title: 'Plano de 21 MB (e2e)',
        entityType: 'polygon',
        entityId,
        file: { name: 'plano-21mb.pdf', mimeType: 'application/pdf', buffer: pdfOf(21 * MB) },
      },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('El archivo supera el máximo de 20 MB');
  });

  test('una planilla de 11 MB recibe 400 con el máximo', async ({ editorRequest }) => {
    const layers = (await (await editorRequest.get('/api/layers')).json()) as { id: number }[];
    expect(layers.length).toBeGreaterThan(0);
    const csv = Buffer.concat([Buffer.from('rol;direccion\n'), Buffer.alloc(11 * MB, 0x20)]);
    const res = await editorRequest.post('/api/imports', {
      multipart: {
        layerId: String(layers[0]!.id),
        file: { name: 'planilla-11mb.csv', mimeType: 'text/csv', buffer: csv },
      },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'El archivo pesa más de 10 MB. Divide la planilla en partes más pequeñas.',
    );
  });
});
