import { z } from 'zod';
import { importStatuses } from '../constants';
import { latSchema, lonSchema, paginationSchema } from './common';
import { importMessageCodes } from './import-rows';

/** Destinos especiales del mapeo de columnas (además de `field.key`) (§5.6). */
export const MAPPING_TARGETS = {
  roleId: 'roleId',
  lat: 'lat',
  lon: 'lon',
  comments: 'comments',
} as const;
export const specialMappingTargets = Object.values(MAPPING_TARGETS);

export const importDelimiters = [',', ';', '\t', '|'] as const;

export const importSourcePatchSchema = z.object({
  sheetName: z.string().max(120).optional(),
  headerRow: z.number().int().min(1).max(1000).optional(),
  delimiter: z.enum(importDelimiters).optional(),
});
export type ImportSourcePatch = z.infer<typeof importSourcePatchSchema>;

export const analyzeImportSchema = z
  .object({
    columnMapping: z.record(z.string(), z.string().nullable()),
    rowFrom: z.number().int().min(1).nullable().optional(),
    rowTo: z.number().int().min(1).nullable().optional(),
    duplicateStrategy: z.enum(['ask', 'skip', 'update']).default('ask'),
    keepExistingOnEmpty: z.boolean().default(true),
    geocode: z.boolean().default(true),
    fullReplace: z.boolean().default(false),
  })
  .refine((v) => !(v.rowFrom && v.rowTo) || v.rowFrom <= v.rowTo, {
    message: 'La fila inicial debe ser menor o igual a la final',
    path: ['rowTo'],
  })
  .refine((v) => !v.fullReplace || (!v.rowFrom && !v.rowTo), {
    message: 'El reemplazo completo no admite rango de filas',
    path: ['fullReplace'],
  });
export type AnalyzeImportInput = z.input<typeof analyzeImportSchema>;
export type AnalyzeImportData = z.output<typeof analyzeImportSchema>;

export const importRowStatuses = ['valid', 'warning', 'duplicate', 'error', 'excluded'] as const;
export type ImportRowStatus = (typeof importRowStatuses)[number];

export const importRowsQuerySchema = paginationSchema.extend({
  status: z.enum(importRowStatuses).optional(),
  code: z.enum(importMessageCodes).optional(),
});
export type ImportRowsQuery = z.infer<typeof importRowsQuerySchema>;

export const importRowPatchSchema = z.object({
  raw: z.record(z.string(), z.string()).optional(),
  resolution: z.enum(['create', 'update', 'skip']).nullable().optional(),
  /** Registro existente elegido cuando hay varios duplicados posibles. */
  updateTargetId: z.number().int().positive().nullable().optional(),
  excluded: z.boolean().optional(),
  roleId: z.string().trim().max(20).nullable().optional(),
  lat: latSchema.nullable().optional(),
  lon: lonSchema.nullable().optional(),
  /** Acepta rol/ubicación sugeridos (§8.5). */
  acceptSuggestion: z.boolean().optional(),
  /** Elegir un candidato de geocodificación por índice. */
  candidateIndex: z.number().int().min(0).optional(),
});
export type ImportRowPatch = z.infer<typeof importRowPatchSchema>;

export const importBulkActions = ['skip', 'update', 'create', 'exclude', 'include', 'accept_suggestion'] as const;
export type ImportBulkAction = (typeof importBulkActions)[number];

export const importRowsBulkSchema = z.object({
  filter: z.object({
    status: z.enum(importRowStatuses).optional(),
    code: z.enum(importMessageCodes).optional(),
  }),
  action: z.enum(importBulkActions),
});
export type ImportRowsBulkInput = z.infer<typeof importRowsBulkSchema>;

export const importRemovalsPatchSchema = z
  .object({
    recordIds: z.array(z.number().int().positive()).optional(),
    all: z.boolean().optional(),
    resolution: z.enum(['keep', 'delete']),
  })
  .refine((v) => v.all || (v.recordIds && v.recordIds.length > 0), {
    message: 'Indica registros o marca todos',
    path: ['recordIds'],
  });
export type ImportRemovalsPatch = z.infer<typeof importRemovalsPatchSchema>;

export const importRevertSchema = z.object({ force: z.boolean().default(false) });

export const importsQuerySchema = paginationSchema.extend({
  layerId: z.coerce.number().int().positive().optional(),
  status: z.enum(importStatuses).optional(),
  userId: z.string().optional(),
});
export type ImportsQuery = z.infer<typeof importsQuerySchema>;

export const importCommitSchema = z.object({
  /** Confirmar aunque queden filas pendientes de geocodificación externa (se importan sin coordenadas). */
  acceptPendingGeocode: z.boolean().default(false),
});

export const importUploadFieldsSchema = z.object({
  layerId: z.coerce.number().int().positive(),
});

