import { z } from 'zod';
import { roleOperationTypes } from '../constants';
import { boolish, isoDateSchema, latSchema, lonSchema, paginationSchema, reasonSchema } from './common';

export const rolesSearchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type RolesSearchQuery = z.infer<typeof rolesSearchSchema>;

export const updateRoleSchema = z
  .object({
    lat: latSchema.nullable().optional(),
    lon: lonSchema.nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => (v.lat === undefined && v.lon === undefined) || (v.lat == null) === (v.lon == null), {
    message: 'Latitud y longitud van juntas',
    path: ['lon'],
  });
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const roleRecordsQuerySchema = z.object({
  includeLineage: boolish.default(false),
});

const roleIdText = z.string().trim().min(3).max(20);

/** Reglas de cantidad por tipo (§8.9). */
export const roleOperationCardinality: Record<
  (typeof roleOperationTypes)[number],
  { origin: [number, number | null]; result: [number, number | null]; supersedes: boolean }
> = {
  subdivision: { origin: [1, 1], result: [2, null], supersedes: true },
  fusion: { origin: [2, null], result: [1, 1], supersedes: true },
  rectificacion: { origin: [1, 1], result: [1, 1], supersedes: true },
  modificacion: { origin: [1, null], result: [0, 0], supersedes: false },
};

export const createRoleOperationSchema = z
  .object({
    type: z.enum(roleOperationTypes, { error: 'Elige el tipo de operación' }),
    effectiveDate: isoDateSchema,
    reference: z.string().trim().max(200).nullable().optional(),
    recordId: z.number().int().positive().nullable().optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
    originRoleIds: z.array(roleIdText).min(1, 'Indica al menos un rol de origen'),
    resultRoleIds: z.array(roleIdText).default([]),
    /** 'inherit' = usar la ubicación de origen mientras no se actualice el padrón (§8.9). */
    resultCoords: z.enum(['none', 'inherit']).default('none'),
  })
  .superRefine((v, ctx) => {
    const rule = roleOperationCardinality[v.type];
    const [oMin, oMax] = rule.origin;
    const [rMin, rMax] = rule.result;
    if (v.originRoleIds.length < oMin || (oMax !== null && v.originRoleIds.length > oMax)) {
      ctx.addIssue({
        code: 'custom',
        path: ['originRoleIds'],
        message:
          oMax === oMin
            ? `Esta operación lleva exactamente ${oMin} rol de origen`
            : `Esta operación lleva al menos ${oMin} roles de origen`,
      });
    }
    if (v.resultRoleIds.length < rMin || (rMax !== null && v.resultRoleIds.length > rMax)) {
      ctx.addIssue({
        code: 'custom',
        path: ['resultRoleIds'],
        message:
          rMax === 0
            ? 'Una modificación no tiene roles resultantes'
            : rMax === rMin
              ? `Esta operación lleva exactamente ${rMin} rol resultante`
              : `Esta operación lleva al menos ${rMin} roles resultantes`,
      });
    }
  });
export type CreateRoleOperationInput = z.input<typeof createRoleOperationSchema>;
export type CreateRoleOperationData = z.output<typeof createRoleOperationSchema>;

export const deleteRoleOperationSchema = z.object({ reason: reasonSchema });

export const roleOperationsQuerySchema = paginationSchema.extend({
  type: z.enum(roleOperationTypes).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  roleId: z.string().optional(),
});
export type RoleOperationsQuery = z.infer<typeof roleOperationsQuerySchema>;
