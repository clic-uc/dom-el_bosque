import { pgEnum } from 'drizzle-orm/pg-core';
import {
  auditActions,
  auditEntities,
  coordsSources,
  departments,
  importStatuses,
  polygonKinds,
  roleOperationTypes,
} from '@/shared/constants';

export const departmentEnum = pgEnum('department', departments);
export const auditActionEnum = pgEnum('audit_action', auditActions);
export const auditEntityEnum = pgEnum('audit_entity', auditEntities);
export const roleOperationTypeEnum = pgEnum('role_operation_type', roleOperationTypes);
export const roleOperationSideEnum = pgEnum('role_operation_side', ['origin', 'result']);
export const coordsSourceEnum = pgEnum('coords_source', coordsSources);
export const importStatusEnum = pgEnum('import_status', importStatuses);
export const duplicateStrategyEnum = pgEnum('duplicate_strategy', ['ask', 'skip', 'update']);
export const importRowStatusEnum = pgEnum('import_row_status', ['valid', 'warning', 'duplicate', 'error', 'excluded']);
export const importRowResolutionEnum = pgEnum('import_row_resolution', ['create', 'update', 'skip']);
export const importRowActionEnum = pgEnum('import_row_action', ['created', 'updated']);
export const polygonKindEnum = pgEnum('polygon_kind', polygonKinds);
export const attachmentEntityEnum = pgEnum('attachment_entity', ['record', 'polygon']);
export const attachmentKindEnum = pgEnum('attachment_kind', ['link', 'file']);
