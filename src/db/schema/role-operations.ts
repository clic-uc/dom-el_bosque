import { date, index, integer, pgTable, primaryKey, serial, text, varchar } from 'drizzle-orm/pg-core';
import { createdAt } from './common';
import { roleOperationSideEnum, roleOperationTypeEnum } from './enums';
import { records } from './records';
import { roles } from './roles';

/** Historial de operaciones sobre roles (§5.3 / §8.9). Solo se agregan filas. */
export const roleOperations = pgTable('role_operations', {
  id: serial('id').primaryKey(),
  type: roleOperationTypeEnum('type').notNull(),
  effectiveDate: date('effective_date').notNull(),
  reference: varchar('reference', { length: 200 }),
  recordId: integer('record_id').references(() => records.id, { onDelete: 'set null' }),
  comment: text('comment'),
  createdBy: varchar('created_by', { length: 64 }),
  createdAt,
});

export const roleOperationRoles = pgTable(
  'role_operation_roles',
  {
    operationId: integer('operation_id')
      .notNull()
      .references(() => roleOperations.id, { onDelete: 'cascade' }),
    roleId: varchar('role_id', { length: 11 })
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    side: roleOperationSideEnum('side').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.operationId, t.roleId, t.side] }),
    index('role_operation_roles_role_idx').on(t.roleId),
  ],
);
