/**
 * Geocodificador (§8.7): proveedor `padron` sobre un padrón de prueba (exact / interpolated / approx),
 * proveedor externo real (`nominatim`) con `fetch` falso: respeta 1 req/s, usa la caché (también para `null`)
 * y descarta resultados fuera de la comuna. Nunca se llama a Nominatim/Photon reales.
 */
import { describe, expect, it } from 'vitest';
import { geocodeCache } from '@/db/schema';
import { createRole, db, IN_COMUNA, IN_COMUNA_2, OUT_OF_COMUNA, setupDbSuite } from '../services/__tests__/helpers';
import { createGeocoder } from './index';
import { createNominatimProvider } from './providers/nominatim';
import { externalThrottle } from './throttle';

setupDbSuite();

async function seedPadron() {
  await createRole('00001-00001', { lat: -33.5600, lon: -70.6600, address: 'RIQUELME 11' });
  await createRole('00001-00002', { lat: -33.5620, lon: -70.6620, address: 'RIQUELME 19' });
  await createRole('00001-00003', { lat: -33.5650, lon: -70.6650, address: 'RIQUELME 111 V ITALIA' });
  await createRole('00001-00004', { lat: -33.5700, lon: -70.6700, address: 'PSJE LOS ALAMOS 123 V ITALIA' });
  await createRole('00001-00005', { lat: null, lon: null, address: 'RIQUELME 15' }); // sin coordenadas: no cuenta
}

describe('proveedor padron (local)', () => {
  it('exact: misma calle y número → coordenadas y roleId del predio', async () => {
    await seedPadron();
    const g = createGeocoder(db, { providers: ['padron'] });
    const r = await g.geocode('Riquelme N° 111, El Bosque');
    expect(r).toMatchObject({ provider: 'padron', confidence: 'exact', roleId: '00001-00003', lat: -33.565, lon: -70.665 });
    expect(r?.label).toBe('RIQUELME 111 V ITALIA');
  });

  it('interpolated: entre los dos vecinos más cercanos de la misma paridad (11 y 19 → 15 al medio)', async () => {
    await seedPadron();
    const g = createGeocoder(db, { providers: ['padron'] });
    const r = await g.geocode('Riquelme 15');
    expect(r?.provider).toBe('padron');
    expect(r?.confidence).toBe('interpolated');
    expect(r?.lat).toBeCloseTo(-33.561, 6);
    expect(r?.lon).toBeCloseTo(-70.661, 6);
    expect(r?.roleId).toBeUndefined();
    expect(r?.candidates).toHaveLength(2);
  });

  it('approx: similitud trigram ≥ 0,6 → mejor candidato con candidatos', async () => {
    await seedPadron();
    const g = createGeocoder(db, { providers: ['padron'] });
    const r = await g.geocode('Pasaje Los Álamos 12 Villa Italia'); // número vecino, sin exacto ni paridad
    expect(r?.provider).toBe('padron');
    expect(r?.confidence).toBe('approx');
    expect(r?.roleId).toBe('00001-00004');
    expect(r?.candidates?.length).toBeGreaterThanOrEqual(1);
  });

  it('sin coincidencia razonable → null; dirección vacía → null', async () => {
    await seedPadron();
    const g = createGeocoder(db, { providers: ['padron'] });
    expect(await g.geocode('Avenida Inexistente 9999')).toBeNull();
    expect(await g.geocode('   ')).toBeNull();
    expect(await g.geocodeExternal('Riquelme 111')).toBeNull(); // no hay externos configurados
  });
});

type FakeHit = { lat: number; lon: number; display_name: string; house_number?: string };

/** `fetch` falso al estilo Nominatim: cuenta llamadas, registra tiempos y simula latencia. */
function fakeNominatimFetch(answers: Record<string, FakeHit[]>, latencyMs = 30) {
  const calls: { at: number; url: string }[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push({ at: Date.now(), url });
    await new Promise((r) => setTimeout(r, latencyMs));
    const street = new URL(url).searchParams.get('street') ?? '';
    const hits = answers[street] ?? [];
    const body = hits.map((h) => ({
      lat: String(h.lat),
      lon: String(h.lon),
      display_name: h.display_name,
      address: h.house_number ? { house_number: h.house_number, road: 'x' } : { road: 'x' },
    }));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

function externalGeocoder(fetchImpl: typeof fetch) {
  const nominatim = createNominatimProvider({ url: 'http://nominatim.test', contactEmail: 'dom@test.cl', fetchImpl });
  return createGeocoder(db, { providers: ['padron', 'nominatim'], overrides: { nominatim } });
}

describe('proveedor externo (nominatim con fetch falso)', () => {
  it('respeta el límite de 1 petición por segundo entre llamadas consecutivas', async () => {
    externalThrottle.reset();
    const { fetchImpl, calls } = fakeNominatimFetch({
      '100 los morros': [{ ...IN_COMUNA, display_name: 'Los Morros 100, El Bosque', house_number: '100' }],
      '200 los morros': [{ ...IN_COMUNA_2, display_name: 'Los Morros 200, El Bosque', house_number: '200' }],
    });
    const g = externalGeocoder(fetchImpl);

    const [a, b] = await Promise.all([g.geocode('Los Morros 100'), g.geocode('Los Morros 200')]);
    expect(a).toMatchObject({ provider: 'nominatim', confidence: 'exact', lat: IN_COMUNA.lat });
    expect(b).toMatchObject({ provider: 'nominatim', confidence: 'exact', lat: IN_COMUNA_2.lat });
    expect(calls).toHaveLength(2);
    const gap = calls[1]!.at - calls[0]!.at;
    expect(gap).toBeGreaterThanOrEqual(950);
    expect(gap).toBeLessThan(2500);
    expect(calls[0]!.url).toContain('bounded=1');
    expect(calls[0]!.url).toContain('email=dom%40test.cl');
  }, 15_000);

  it('usa la caché: la misma dirección no vuelve a llamar al proveedor; el null también se cachea', async () => {
    externalThrottle.reset();
    const { fetchImpl, calls } = fakeNominatimFetch({
      '100 los morros': [{ ...IN_COMUNA, display_name: 'Los Morros 100', house_number: '100' }],
      // 'calle fantasma' → [] (sin resultado)
    });
    const g = externalGeocoder(fetchImpl);

    const first = await g.geocode('Los Morros 100');
    expect(first?.provider).toBe('nominatim');
    expect(calls).toHaveLength(1);
    const again = await g.geocode('Los Morros N° 100'); // misma dirección normalizada
    expect(again).toEqual(first);
    expect(calls).toHaveLength(1);

    const none = await g.geocode('Calle Fantasma 1');
    expect(none).toBeNull();
    expect(calls).toHaveLength(2);
    const noneAgain = await g.geocode('calle fantasma 1');
    expect(noneAgain).toBeNull();
    expect(calls).toHaveLength(2);

    const cached = await db.select().from(geocodeCache);
    expect(cached).toHaveLength(2);
    expect(cached.find((c) => c.query === 'calle fantasma 1')?.result).toBeNull();
    expect(cached.every((c) => c.provider === 'nominatim')).toBe(true);
  }, 15_000);

  it('descarta resultados fuera de la comuna y filtra candidatos', async () => {
    externalThrottle.reset();
    const { fetchImpl, calls } = fakeNominatimFetch({
      '5 alameda': [
        { ...OUT_OF_COMUNA, display_name: 'Alameda 5, Santiago', house_number: '5' },
        { ...IN_COMUNA, display_name: 'Alameda 5, El Bosque' },
      ],
    });
    const g = externalGeocoder(fetchImpl);
    expect(await g.geocode('Alameda 5')).toBeNull();
    expect(calls).toHaveLength(1);
  }, 15_000);

  it('el padrón gana antes de consultar al externo', async () => {
    externalThrottle.reset();
    await seedPadron();
    const { fetchImpl, calls } = fakeNominatimFetch({});
    const g = externalGeocoder(fetchImpl);
    const r = await g.geocode('Riquelme 111');
    expect(r?.provider).toBe('padron');
    expect(calls).toHaveLength(0);
    // geocodeLocal nunca sale a internet
    expect(await g.geocodeLocal('Calle Fantasma 1')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('un error de red no se cachea', async () => {
    externalThrottle.reset();
    let n = 0;
    const failing: typeof fetch = async () => {
      n++;
      throw new Error('ECONNRESET');
    };
    const g = externalGeocoder(failing);
    expect(await g.geocode('Los Morros 100')).toBeNull();
    expect(n).toBe(1);
    expect(await db.select().from(geocodeCache)).toHaveLength(0);
  });
});
