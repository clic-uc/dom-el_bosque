import { z } from 'zod';
import { auditActions, auditEntities } from '../constants';
import { isoDateSchema, paginationSchema } from './common';

export const auditLogsQuerySchema = paginationSchema.extend({
  action: z.enum(auditActions).optional(),
  entityType: z.enum(auditEntities).optional(),
  layerId: z.coerce.number().int().positive().optional(),
  userId: z.string().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
