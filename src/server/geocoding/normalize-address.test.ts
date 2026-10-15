import { describe, expect, it } from 'vitest';
import { looksLikeAddress, normalizeAddress } from './normalize-address';

describe('normalizeAddress (§8.7)', () => {
  it('separa calle y número', () => {
    expect(normalizeAddress('RIQUELME 111 V ITALIA')).toMatchObject({
      streetNorm: 'riquelme',
      houseNumber: 111,
      addressNorm: 'riquelme 111 villa italia',
    });
  });

  it('unifica abreviaturas y quita acentos y puntuación', () => {
    expect(normalizeAddress('Av. José Miguel Carrera N° 1234, El Bosque')).toMatchObject({
      streetNorm: 'avenida jose miguel carrera',
      houseNumber: 1234,
    });
    expect(normalizeAddress('Psje. Los Álamos #45')).toMatchObject({ streetNorm: 'pasaje los alamos', houseNumber: 45 });
    expect(normalizeAddress('Gral. Baquedano 12')).toMatchObject({ streetNorm: 'general baquedano', houseNumber: 12 });
  });

  it('quita comuna, región y país', () => {
    const n = normalizeAddress('Alejandro Guzmán 1015, El Bosque, Región Metropolitana, Chile');
    expect(n.streetNorm).toBe('alejandro guzman');
    expect(n.houseNumber).toBe(1015);
    expect(n.addressNorm).not.toContain('chile');
  });

  it('reconoce S/N y descarta complementos', () => {
    expect(normalizeAddress('Camino Lo Espejo S/N')).toMatchObject({ streetNorm: 'camino lo espejo', houseNumber: null });
    expect(normalizeAddress('Los Morros 5555 Depto 302 Block B')).toMatchObject({
      streetNorm: 'los morros',
      houseNumber: 5555,
      complement: 'depto 302 block b',
    });
  });

  it('conserva las calles que empiezan con N o Ñ', () => {
    expect(normalizeAddress('Nueva Imperial 100')).toMatchObject({
      streetNorm: 'nueva imperial',
      houseNumber: 100,
    });
    expect(normalizeAddress('Los Nogales 55')).toMatchObject({ streetNorm: 'los nogales', houseNumber: 55 });
    expect(normalizeAddress('Pasaje Ñuble 20')).toMatchObject({
      streetNorm: 'pasaje nuble',
      houseNumber: 20,
    });
    expect(normalizeAddress('Av. Nueva Ejemplo 100')).toMatchObject({ streetNorm: 'avenida nueva ejemplo', houseNumber: 100 });
    expect(normalizeAddress('Pasaje Norte Ejemplo 50')).toMatchObject({ streetNorm: 'pasaje norte ejemplo', houseNumber: 50 });
    expect(normalizeAddress('Calle Numancia 8')).toMatchObject({
      streetNorm: 'calle numancia',
      houseNumber: 8,
    });
  });

  it('quita los marcadores de número antes del número', () => {
    for (const s of [
      'Riquelme N° 111',
      'Riquelme Nº111',
      'Riquelme Nro 111',
      'Riquelme No. 111',
      'Riquelme Num 111',
      'Riquelme Número 111',
      'Riquelme numero 111',
      'Riquelme No 111',
      'Riquelme #111',
    ]) {
      expect(normalizeAddress(s), s).toMatchObject({
        streetNorm: 'riquelme',
        houseNumber: 111,
        addressNorm: 'riquelme 111',
      });
    }
  });

  it('dirección vacía', () => {
    expect(normalizeAddress('')).toEqual({ addressNorm: '', streetNorm: null, houseNumber: null, complement: null });
  });

  it('looksLikeAddress', () => {
    expect(looksLikeAddress('riquelme 111')).toBe(true);
    expect(looksLikeAddress('los morros')).toBe(true);
    expect(looksLikeAddress('50-1')).toBe(false);
    expect(looksLikeAddress('ab')).toBe(false);
  });
});
