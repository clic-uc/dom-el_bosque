import { COMUNA_BOUNDS } from '@/shared/constants';
import type { GeocodeResult } from '@/shared/schemas/geocode';
import { logger } from '../../logger';
import type { NormalizedAddress } from '../normalize-address';
import { externalThrottle } from '../throttle';
import type { GeocodeProvider } from './types';

/**
 * Nominatim (OSM) (§8.7). Política de uso: User-Agent identificable, máximo 1 petición/segundo
 * en todo el sistema (throttle compartido), resultados cacheados por el orquestador.
 */
type NominatimItem = {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
  address?: { house_number?: string; road?: string };
};

export type ExternalProviderConfig = { url: string; contactEmail?: string; fetchImpl?: typeof fetch };

export function createNominatimProvider(cfg: ExternalProviderConfig): GeocodeProvider {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    name: 'nominatim',
    local: false,
    async geocode(address, n: NormalizedAddress): Promise<GeocodeResult | null> {
      if (!n.streetNorm) return null;
      const street = n.houseNumber !== null ? `${n.houseNumber} ${n.streetNorm}` : n.streetNorm;
      const params = new URLSearchParams({
        street,
        city: 'El Bosque',
        state: 'Región Metropolitana',
        country: 'Chile',
        format: 'jsonv2',
        addressdetails: '1',
        limit: '3',
        viewbox: `${COMUNA_BOUNDS.minLon},${COMUNA_BOUNDS.maxLat},${COMUNA_BOUNDS.maxLon},${COMUNA_BOUNDS.minLat}`,
        bounded: '1',
      });
      if (cfg.contactEmail) params.set('email', cfg.contactEmail);

      await externalThrottle.wait();
      const url = `${cfg.url.replace(/\/$/, '')}/search?${params.toString()}`;
      const res = await fetchImpl(url, {
        headers: {
          'User-Agent': `SIGDOM-El-Bosque/1.0 (${cfg.contactEmail ?? 'sin-contacto'})`,
          Accept: 'application/json',
          'Accept-Language': 'es',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Nominatim respondió con error');
        return null;
      }
      const items = (await res.json()) as NominatimItem[];
      const first = items[0];
      if (!first) return null;
      const lat = Number(first.lat);
      const lon = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const hasNumber = !!first.address?.house_number;
      return {
        lat,
        lon,
        provider: 'nominatim',
        confidence: hasNumber ? 'exact' : 'street',
        label: first.display_name,
        candidates: items.slice(0, 3).map((it) => ({
          lat: Number(it.lat),
          lon: Number(it.lon),
          label: it.display_name,
          confidence: it.address?.house_number ? 'exact' : 'street',
        })),
      };
    },
  };
}
