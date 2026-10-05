import { z } from 'zod';
import { coordsSources } from '../constants';
import { boolish, latSchema, lonSchema, paginationSchema, reasonSchema } from './common';

const attributesSchema = z.record(z.string(), z.unknown());

/** `roleId` llega como texto libre y se normaliza en el servidor (§8.1). */
const roleIdInputSchema = z.string().trim().max(20).nullable();

export const createRecordSchema = z
  .object({
    layerId: z.number().int().positive(),
    roleId: roleIdInputSchema.optional(),
    lat: latSchema.nullable().optional(),
    lon: lonSchema.nullable().optional(),
    attributes: attributesSchema.default({}),
    comments: z.string().max(5000).nullable().optional(),
  })
  .refine((v) => (v.lat == null) === (v.lon == null), {
    message: 'Latitud y longitud van juntas',
    path: ['lon'],
  });
export type CreateRecordInput = z.input<typeof createRecordSchema>;
export type CreateRecordData = z.output<typeof createRecordSchema>;

export const updateRecordSchema = z
  .object({
    roleId: roleIdInputSchema.optional(),
    lat: latSchema.nullable().optional(),
    lon: lonSchema.nullable().optional(),
    attributes: attributesSchema.optional(),
    comments: z.string().max(5000).nullable().optional(),
  })
  .refine((v) => (v.lat === undefined && v.lon === undefined) || (v.lat == null) === (v.lon == null), {
    message: 'Latitud y longitud van juntas',
    path: ['lon'],
  });
export type UpdateRecordInput = z.input<typeof updateRecordSchema>;
export type UpdateRecordData = z.output<typeof updateRecordSchema>;

export const updateCoordinatesSchema = z.union([
  z.object({ useRole: z.literal(true) }),
  z.object({ lat: latSchema, lon: lonSchema, scope: z.enum(['record', 'role']).default('record') }),
]);
export type UpdateCoordinatesInput = z.input<typeof updateCoordinatesSchema>;

export const deleteRecordSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const filtersSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({});
export type RecordFilters = z.infer<typeof filtersSchema>;

export const recordSortKeys = ['id', 'roleId', 'lat', 'lon', 'updatedAt', 'createdAt'] as const;

export const recordsQuerySchema = paginationSchema.extend({
  sort: z
    .string()
    .regex(/^(id|roleId|lat|lon|updatedAt|createdAt|attr:[a-z][a-z0-9_]*)$/)
    .default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
  filters: filtersSchema,
  hasCoordinates: boolish.optional(),
  coordsSource: z.enum(coordsSources).optional(),
  /** Filtro del correlativo: con número / sin número (§10.2). */
  hasNumber: boolish.optional(),
});
export type RecordsQuery = z.infer<typeof recordsQuerySchema>;

export const featuresQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  filters: filtersSchema,
  weight: boolish.optional(),
  hasCoordinates: boolish.optional(),
  coordsSource: z.enum(coordsSources).optional(),
  hasNumber: boolish.optional(),
});
export type FeaturesQuery = z.infer<typeof featuresQuerySchema>;

export const setNumberSchema = z.object({
  value: z.number().int().positive().nullable(),
  reason: reasonSchema,
});
export type SetNumberInput = z.infer<typeof setNumberSchema>;

export const setNextNumberSchema = z.object({
  period: z.string().regex(/^(\d{4})?$/).default(''),
  next: z.number().int().positive(),
  reason: reasonSchema,
});
export type SetNextNumberInput = z.infer<typeof setNextNumberSchema>;

export const duplicatesPreviewQuerySchema = z.object({
  keys: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    ),
});

export const exportQuerySchema = z.object({
  delimiter: z.enum([',', ';']).default(';'),
});
