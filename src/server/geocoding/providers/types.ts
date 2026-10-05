import type { GeocodeResult } from '@/shared/schemas/geocode';
import type { NormalizedAddress } from '../normalize-address';

export type GeocodeProviderName = 'padron' | 'nominatim' | 'photon';

export interface GeocodeProvider {
  readonly name: GeocodeProviderName;
  /** `true` si es local (sin límite de tasa ni caché). */
  readonly local: boolean;
  geocode(address: string, normalized: NormalizedAddress): Promise<GeocodeResult | null>;
}
