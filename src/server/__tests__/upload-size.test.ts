/**
 * Subidas: el tamaño se comprueba por `Content-Length` antes de leer el cuerpo, y las rutas de subida quedan
 * fuera del proxy (si no, Next copia el cuerpo entero en memoria antes de llegar a la ruta).
 */
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config } from '../../../proxy';
import { ValidationError } from '@/server/errors';
import { assertBodySize } from '@/server/http';

const MB = 1024 * 1024;

function upload(contentLength?: number): Request {
  const headers = new Headers({ 'content-type': 'multipart/form-data; boundary=x' });
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return new Request('http://localhost/api/attachments', { method: 'POST', headers, body: 'x' });
}

describe('assertBodySize', () => {
  it('rechaza por Content-Length sin leer el cuerpo', () => {
    const req = upload(25 * MB);
    expect(() => assertBodySize(req, 20 * MB, 'El archivo supera el máximo de 20 MB')).toThrow(
      new ValidationError('El archivo supera el máximo de 20 MB'),
    );
    expect(req.bodyUsed).toBe(false);
  });

  it('acepta hasta el máximo más el margen del multipart', () => {
    expect(() => assertBodySize(upload(20 * MB), 20 * MB, 'x')).not.toThrow();
    expect(() => assertBodySize(upload(21 * MB), 20 * MB, 'x')).not.toThrow();
    expect(() => assertBodySize(upload(21 * MB + 1), 20 * MB, 'x')).toThrow(ValidationError);
  });

  it('rechaza si falta Content-Length', () => {
    const req = upload();
    req.headers.delete('content-length');
    expect(() => assertBodySize(req, 20 * MB, 'x')).toThrow(/tamaño del archivo/);
  });
});

describe('matcher de proxy.ts', () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it('deja fuera las tres rutas de subida', () => {
    expect(matches('/api/attachments')).toBe(false);
    expect(matches('/api/imports')).toBe(false);
    expect(matches('/api/roles/import')).toBe(false);
  });

  it('sigue cubriendo el resto, incluidas rutas que empiezan igual', () => {
    for (const url of [
      '/api/layers',
      '/map',
      '/api/attachments/abc/download',
      '/api/imports/abc',
      '/api/roles',
    ]) {
      expect(matches(url), url).toBe(true);
    }
  });
});
