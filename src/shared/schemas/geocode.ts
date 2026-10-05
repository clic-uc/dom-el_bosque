import { z } from 'zod';
import { geocodeConfidences } from '../constants';

export const geocodeCandidateSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  label: z.string(),
  roleId: z.string().nullable().optional(),
  confidence: z.enum(geocodeConfidences),
});
export type GeocodeCandidate = z.infer<typeof geocodeCandidateSchema>;

export const geocodeResultSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  provider: z.string(),
  confidence: z.enum(geocodeConfidences),
  roleId: z.string().nullable().optional(),
  label: z.string(),
  candidates: z.array(geocodeCandidateSchema).optional(),
});
export type GeocodeResult = z.infer<typeof geocodeResultSchema>;

/** Lo que se guarda en `records.geocode` cuando `coords_source = 'geocoded'` (§5.4). */
export const recordGeocodeInfoSchema = z.object({
  provider: z.string(),
  confidence: z.enum(geocodeConfidences),
  query: z.string(),
});
export type RecordGeocodeInfo = z.infer<typeof recordGeocodeInfoSchema>;

export const geocodeQuerySchema = z.object({
  q: z.string().trim().min(3, 'Escribe al menos 3 letras').max(200),
});
