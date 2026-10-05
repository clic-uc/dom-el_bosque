import { COMUNA_BOUNDS } from '@/shared/constants';
import type { GeocodeResult } from '@/shared/schemas/geocode';
import { logger } from '../../logger';
import type { NormalizedAddress } from '../normalize-address';
import { externalThrottle } from '../throttle';
import type { ExternalProviderConfig } from './nominatim';
import type { GeocodeProvider } from './types';

/** Photon (Komoot, sobre OSM), opcional si `PHOTON_URL` está definido (§8.7). Mismo contrato y límites. */
type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; street?: string; housenumber?: string; city?: string; osm_value?: string };
};

export function createPhotonProvider(cfg: ExternalProviderConfig): GeocodeProvider {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    name: 'photon',
    local: false,
    async geocode(address, n: NormalizedAddress): Promise<GeocodeResult | null> {
      if (!n.streetNorm) return null;
      const q = `${n.streetNorm}${n.houseNumber !== null ? ` ${n.houseNumber}` : ''}, El Bosque`;
      const params = new URLSearchParams({
        q,
        limit: '3',
        lang: 'es',
        bbox: `${COMUNA_BOUNDS.minLon},${COMUNA_BOUNDS.minLat},${COMUNA_BOUNDS.maxLon},${COMUNA_BOUNDS.maxLat}`,
      });
      await externalThrottle.wait();
      const res = await fetchImpl(`${cfg.url.replace(/\/$/, '')}/api?${params.toString()}`, {
        headers: { 'User-Agent': `SIGDOM-El-Bosque/1.0 (${cfg.contactEmail ?? 'sin-contacto'})`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Photon respondió con error');
        return null;
      }
      const data = (await res.json()) as { features: PhotonFeature[] };
      const first = data.features?.[0];
      if (!first) return null;
      const [lon, lat] = first.geometry.coordinates;
      const label = [first.properties.street ?? first.properties.name, first.properties.housenumber, first.properties.city]
        .filter(Boolean)
        .join(' ');
      return {
        lat,
        lon,
        provider: 'photon',
        confidence: first.properties.housenumber ? 'exact' : 'street',
        label: label || address,
        candidates: data.features.slice(0, 3).map((f) => ({
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          label:
            [f.properties.street ?? f.properties.name, f.properties.housenumber, f.properties.city].filter(Boolean).join(' ') ||
            address,
          confidence: f.properties.housenumber ? 'exact' : 'street',
        })),
      };
    },
  };
}
