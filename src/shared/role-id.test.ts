import { describe, expect, it } from 'vitest';
import { looksLikeRoleId, normalizeRoleId, RoleIdInvalidError, tryNormalizeRoleId } from './role-id';

describe('normalizeRoleId (§8.1)', () => {
  it('rellena con ceros a la izquierda', () => {
    expect(normalizeRoleId('4631-30')).toBe('04631-00030');
    expect(normalizeRoleId('04631-00030')).toBe('04631-00030');
    expect(normalizeRoleId(' 12-3 ')).toBe('00012-00003');
  });

  it('trata "sin rol" y vacíos como null', () => {
    for (const v of ['sin rol', 'SIN ROL', 's/rol', 'S/ Rol', '', '   ', null, undefined]) {
      expect(normalizeRoleId(v)).toBeNull();
    }
  });

  it('rechaza formatos inválidos', () => {
    for (const v of ['abc-12', '123', '1-2-3', '123456-1', '1-123456']) {
      expect(() => normalizeRoleId(v)).toThrow(RoleIdInvalidError);
    }
    expect(() => normalizeRoleId('abc-12')).toThrow('Debe ser XXXXX-XXXXX con solo números');
  });

  it('acepta separadores alternativos que vienen de Excel', () => {
    expect(normalizeRoleId('4631 – 30')).toBe('04631-00030');
    expect(normalizeRoleId('4631/30')).toBe('04631-00030');
  });

  it('tryNormalizeRoleId nunca lanza', () => {
    expect(tryNormalizeRoleId('1-2')).toEqual({ ok: true, value: '00001-00002' });
    expect(tryNormalizeRoleId('x')).toMatchObject({ ok: false });
  });

  it('looksLikeRoleId detecta roles parciales', () => {
    expect(looksLikeRoleId('50')).toBe(true);
    expect(looksLikeRoleId('50-1')).toBe(true);
    expect(looksLikeRoleId('00050-')).toBe(true);
    expect(looksLikeRoleId('riquelme 111')).toBe(false);
  });
});
