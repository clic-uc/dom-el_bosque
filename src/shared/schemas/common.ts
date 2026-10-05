import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants';

/** Para query strings: 'true' | '1' | true → true. */
export const boolish = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null || v === '') return undefined;
  return v === 'true' || v === '1' || v === 'on';
}, z.boolean());

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type Pagination = z.infer<typeof paginationSchema>;

export type Paginated<T> = { data: T[]; total: number; page: number; pageSize: number };

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (usa aaaa-mm-dd)')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Fecha inválida');

export const idParamSchema = z.coerce.number().int().positive();
export const uuidParamSchema = z.string().uuid();

export const latSchema = z.number().min(-90).max(90);
export const lonSchema = z.number().min(-180).max(180);

export const coordinatesSchema = z.object({ lat: latSchema, lon: lonSchema });
export type Coordinates = z.infer<typeof coordinatesSchema>;

export const reasonSchema = z.string().trim().min(3, 'Escribe el motivo (al menos 3 letras)').max(500);
