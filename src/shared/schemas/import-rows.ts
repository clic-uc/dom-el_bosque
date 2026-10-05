import { z } from 'zod';
import { coordsSources } from '../constants';
import { recordGeocodeInfoSchema } from './geocode';

/** Mensajes de una fila en revisión (§5.6). `code` es estable para filtrar y para acciones en bloque. */
export const importMessageLevels = ['error', 'warning', 'info'] as const;
export type ImportMessageLevel = (typeof importMessageLevels)[number];

export const importMessageCodes = [
  // errores
  'role_invalid',
  'required_missing',
  'type_invalid',
  'coords_out_of_range',
  'autonumber_invalid',
  // duplicados
  'duplicate_existing',
  'duplicate_in_file',
  // advertencias
  'coords_outside_comuna',
  'location_approx',
  'location_missing',
  'location_pending',
  'role_assigned_by_address',
  'role_suggested_by_address',
  'unique_keys_incomplete',
  'role_new',
  'role_superseded',
  // info
  'role_has_records',
  'role_adopted_coords',
] as const;
export type ImportMessageCode = (typeof importMessageCodes)[number];

export const importMessageSchema = z.object({
  level: z.enum(importMessageLevels),
  code: z.enum(importMessageCodes),
  message: z.string(),
  /** Datos auxiliares (p. ej. roles sugeridos, candidatos de geocodificación). */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ImportMessage = z.infer<typeof importMessageSchema>;

/** Resultado del análisis de una fila (§5.6 `import_rows.parsed`). */
export const parsedRowSchema = z.object({
  roleId: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  coordsSource: z.enum(coordsSources).nullable(),
  geocode: recordGeocodeInfoSchema.nullable(),
  attributes: z.record(z.string(), z.unknown()),
  comments: z.string().nullable().optional(),
  /** Rol sugerido por dirección (aproximado), pendiente de aceptar. */
  suggestedRoleId: z.string().nullable().optional(),
  /** Ubicación sugerida pendiente de aceptar (aproximada). */
  suggestedLocation: z
    .object({ lat: z.number(), lon: z.number(), geocode: recordGeocodeInfoSchema })
    .nullable()
    .optional(),
});
export type ParsedRow = z.infer<typeof parsedRowSchema>;
