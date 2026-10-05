import { z } from 'zod';
import { polygonKinds } from '../constants';

export const polygonsQuerySchema = z.object({
  kind: z.enum(polygonKinds),
});

export const polygonStatsQuerySchema = z.object({
  kind: z.enum(polygonKinds),
  layerId: z.coerce.number().int().positive(),
});
export type PolygonStatsQuery = z.infer<typeof polygonStatsQuerySchema>;

export const updatePolygonSchema = z.object({
  name: z.string().trim().min(1, 'Escribe un nombre').max(200).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export type UpdatePolygonInput = z.infer<typeof updatePolygonSchema>;
