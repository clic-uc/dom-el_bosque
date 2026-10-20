import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('conserva las rutas internas con su query', () => {
    expect(safeNextPath('/help')).toBe('/help');
    expect(safeNextPath('/map?layer=1&record=2')).toBe('/map?layer=1&record=2');
    expect(safeNextPath('/admin/users#roles')).toBe('/admin/users#roles');
  });

  it('vuelve a /map si el destino no es una ruta interna', () => {
    for (const next of [
      '/\\evil.example',
      '//evil',
      'https://evil',
      '/\t/evil',
      '/\n/evil',
      'help',
      '',
      undefined,
      null,
    ]) {
      expect(safeNextPath(next), String(next)).toBe('/map');
    }
  });

  it('vuelve a /map si al normalizar los puntos el destino queda apuntando a otro sitio', () => {
    for (const next of [
      '/.//evil.com',
      '/..//evil.com',
      '/%2e//evil.com',
      '/%2E%2E//evil.com',
      '/a/..//evil.com/p?q#h',
    ]) {
      expect(safeNextPath(next), next).toBe('/map');
    }
  });

  it('vuelve a /map si el parámetro llega repetido', () => {
    expect(safeNextPath(['/help', '/x'])).toBe('/map');
  });

  it('acepta otro destino por defecto', () => {
    expect(safeNextPath('//evil', '/account/password')).toBe('/account/password');
  });
});
