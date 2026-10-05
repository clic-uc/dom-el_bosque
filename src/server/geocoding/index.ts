import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { geocodeCache } from '@/db/schema';
import { env } from '@/env';
import type { GeocodeResult } from '@/shared/schemas/geocode';
import { logger } from '../logger';
import { isInsideComuna } from '../parsing/coordinates';
import { normalizeAddress } from './normalize-address';
import { createNominatimProvider } from './providers/nominatim';
import { createPadronProvider } from './providers/padron';
import { createPhotonProvider } from './providers/photon';
import type { GeocodeProvider, GeocodeProviderName } from './providers/types';

/**
 * Orquestador (§8.7): proveedores en cadena según `GEOCODER_PROVIDERS`; el primero que devuelve un
 * resultado dentro de la comuna gana. Los externos pasan por `geocode_cache` (también los vacíos).
 */

export type Geocoder = {
  geocode(address: string): Promise<GeocodeResult | null>;
  /** Solo proveedores locales (análisis de importación). */
  geocodeLocal(address: string): Promise<GeocodeResult | null>;
  /** Solo externos (cola `import.geocode-external`). */
  geocodeExternal(address: string): Promise<GeocodeResult | null>;
  providers: GeocodeProvider[];
};

export type GeocoderOptions = {
  providers?: GeocodeProviderName[];
  /** Para tests: reemplaza los proveedores externos. */
  overrides?: Partial<Record<GeocodeProviderName, GeocodeProvider>>;
  fetchImpl?: typeof fetch;
};

export function createGeocoder(db: DbOrTx, opts: GeocoderOptions = {}): Geocoder {
  const names = opts.providers ?? env.GEOCODER_PROVIDERS;
  const providers: GeocodeProvider[] = [];
  for (const name of names) {
    const override = opts.overrides?.[name];
    if (override) {
      providers.push(override);
      continue;
    }
    if (name === 'padron') providers.push(createPadronProvider(db));
    else if (name === 'nominatim') {
      providers.push(createNominatimProvider({ url: env.NOMINATIM_URL, contactEmail: env.GEOCODER_CONTACT_EMAIL, fetchImpl: opts.fetchImpl }));
    } else if (name === 'photon' && env.PHOTON_URL) {
      providers.push(createPhotonProvider({ url: env.PHOTON_URL, contactEmail: env.GEOCODER_CONTACT_EMAIL, fetchImpl: opts.fetchImpl }));
    }
  }

  async function withCache(p: GeocodeProvider, query: string, run: () => Promise<GeocodeResult | null>): Promise<GeocodeResult | null> {
    if (p.local) return run();
    const [hit] = await db
      .select({ result: geocodeCache.result })
      .from(geocodeCache)
      .where(and(eq(geocodeCache.provider, p.name), eq(geocodeCache.query, query)))
      .limit(1);
    if (hit) return hit.result ?? null;
    let result: GeocodeResult | null = null;
    try {
      result = await run();
    } catch (err) {
      logger.warn({ err, provider: p.name }, 'Error del geocodificador externo');
      return null; // no cacheamos errores de red
    }
    await db
      .insert(geocodeCache)
      .values({ provider: p.name, query, result })
      .onConflictDoNothing();
    return result;
  }

  async function runChain(address: string, filter: (p: GeocodeProvider) => boolean): Promise<GeocodeResult | null> {
    const n = normalizeAddress(address);
    if (!n.addressNorm) return null;
    for (const p of providers.filter(filter)) {
      const result = await withCache(p, n.addressNorm, () => p.geocode(address, n));
      if (result && isInsideComuna(result.lat, result.lon)) {
        return {
          ...result,
          candidates: result.candidates?.filter((c) => isInsideComuna(c.lat, c.lon)),
        };
      }
    }
    return null;
  }

  return {
    providers,
    geocode: (address) => runChain(address, () => true),
    geocodeLocal: (address) => runChain(address, (p) => p.local),
    geocodeExternal: (address) => runChain(address, (p) => !p.local),
  };
}

declare global {
  var __sigdomGeocoder: Geocoder | undefined;
}

/** Geocodificador por defecto de la app (singleton por proceso). */
export function getGeocoder(db: DbOrTx): Geocoder {
  if (!globalThis.__sigdomGeocoder) globalThis.__sigdomGeocoder = createGeocoder(db);
  return globalThis.__sigdomGeocoder;
}

export { normalizeAddress };
export type { GeocodeProvider, GeocodeProviderName };
