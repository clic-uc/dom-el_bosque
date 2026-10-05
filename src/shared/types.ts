/**
 * Tipos compartidos entre cliente y servidor (§3.4 punto 27). Derivados del esquema Drizzle y de Zod.
 * Los DTOs de API son "JSON-safe": las fechas viajan como string ISO.
 */
import type { InferSelectModel } from 'drizzle-orm';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import type * as s from '@/db/schema';
import type { AuditAction, AuditEntity, CoordsSource, Department, GeocodeConfidence, ImportStatus, PolygonKind, RoleOperationType, UserRole } from './constants';
import type { Role } from './permissions';
import type { GeocodeCandidate, GeocodeResult, RecordGeocodeInfo } from './schemas/geocode';
import type { ImportMessage, ParsedRow } from './schemas/import-rows';
import type { ImportRowStatus } from './schemas/imports';
import type { LayerField } from './schemas/layers';

/** Convierte Date → string recursivamente (lo que llega al cliente tras JSON.stringify). */
export type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

export type { Paginated } from './schemas/common';
export type { LayerField, GeocodeResult, GeocodeCandidate, RecordGeocodeInfo, ImportMessage, ParsedRow };

// ---------- Capas ----------
export type LayerRow = InferSelectModel<typeof s.layers>;
export type Layer = Jsonified<LayerRow>;
export type LayerWithCount = Layer & { recordCount: number };

export type DuplicatesPreview = {
  groups: number;
  records: number;
  sample: { key: Record<string, string>; recordIds: number[] }[];
};

export type TypeConversionPreview = {
  key: string;
  label: string;
  fromType: string;
  toType: string;
  convertible: number;
  notConvertible: number;
  samples: unknown[];
};

export type LayerCounter = { fieldKey: string; period: string; lastValue: number; next: number };

// ---------- Roles ----------
export type RoleRow = InferSelectModel<typeof s.roles>;
export type RoleDto = Jsonified<RoleRow> & {
  vigente: boolean;
  /** Roles resultantes si el rol no está vigente. */
  resultRoleIds?: string[];
  recordCount?: number;
};

export type RoleOperationRow = InferSelectModel<typeof s.roleOperations>;
export type RoleOperationDto = Jsonified<RoleOperationRow> & {
  originRoleIds: string[];
  resultRoleIds: string[];
  record?: { id: number; layerId: number; layerName: string; summary: SummaryItem[] } | null;
};

export type RoleHistory = {
  operations: RoleOperationDto[];
  ancestors: string[];
  descendants: string[];
};

export type SummaryItem = { label: string; value: string };

export type RoleRecordItem = {
  id: number;
  roleId: string | null;
  summary: SummaryItem[];
  updatedAt: string;
  hasCoordinates: boolean;
  lat: number | null;
  lon: number | null;
  coordsSource: CoordsSource | null;
};

export type RoleRecordsLayerGroup = {
  layerId: number;
  layerName: string;
  icon: string;
  iconColor: string;
  records: RoleRecordItem[];
};

export type RoleRecords = {
  role: RoleDto;
  history: RoleHistory;
  total: number;
  layerCount: number;
  groups: { department: Department; layers: RoleRecordsLayerGroup[] }[];
};

export type BulkImportSummary = {
  totalRows: number;
  upsertedRoles: number;
  updatedRecords: number;
  invalidRows: { rowNumber: number; message: string }[];
  /** Roles vigentes del sistema que no vienen en el padrón (pista de operaciones pendientes). */
  missingFromPadron: string[];
};

// ---------- Registros ----------
export type RecordRow = InferSelectModel<typeof s.records>;
export type RecordDto = Jsonified<Omit<RecordRow, 'geom'>>;

export type AttachmentRow = InferSelectModel<typeof s.attachments>;
export type AttachmentDto = Jsonified<AttachmentRow>;

export type RecordDetail = RecordDto & {
  role: RoleDto | null;
  layer: Pick<Layer, 'id' | 'name' | 'slug' | 'hasRole' | 'fields' | 'uniqueKeys' | 'icon' | 'iconColor' | 'department'>;
  attachments: AttachmentDto[];
  /** Otros registros del mismo rol en todas las capas. */
  sameRoleCount: number;
  /** Operación que este registro respalda, si existe (§10.2). */
  backsOperation: { id: number; type: RoleOperationType; originRoleIds: string[] } | null;
  /** Última operación del rol del registro, si el rol no está vigente. */
  roleLastOperation: RoleOperationDto | null;
};

export type RecordListItem = RecordDto;

export type RecordFeatureProps = {
  id: number;
  roleId: string | null;
  coordsSource: CoordsSource;
  w?: number;
  [attrKey: string]: unknown;
};
export type RecordFeature = Feature<Point, RecordFeatureProps>;
export type RecordFeatureCollection = FeatureCollection<Point, RecordFeatureProps>;

export type FilterOptions = Record<string, string[] | 'text'>;

// ---------- Polígonos ----------
export type PolygonRow = InferSelectModel<typeof s.polygons>;
export type PolygonFeatureProps = { id: number; kind: PolygonKind; name: string | null; code: string | null };
export type PolygonFeatureCollection = FeatureCollection<Polygon | MultiPolygon, PolygonFeatureProps>;

export type PolygonDetail = Jsonified<Omit<PolygonRow, 'geom'>> & {
  attachments: AttachmentDto[];
  counts: { layerId: number; layerName: string; icon: string; iconColor: string; count: number }[];
  sector?: { id: number; name: string | null } | null;
  bbox: [number, number, number, number] | null;
  centroid: { lat: number; lon: number } | null;
};

export type PolygonStat = { polygonId: number; name: string | null; count: number };

// ---------- Importaciones ----------
export type ImportRow = InferSelectModel<typeof s.imports>;
export type ImportItem = Jsonified<ImportRow> & { layerName?: string };

export type ImportSource = {
  importId: string;
  fileType: 'csv' | 'xlsx';
  sheets?: string[];
  sheetName?: string | null;
  headerRow: number;
  delimiter?: string | null;
  headers: string[];
  totalRows: number;
  /** 20 filas de vista previa con su número real de planilla. */
  preview: { rowNumber: number; values: Record<string, string> }[];
  /** Mapeo sugerido por nombre (§10.2 paso 2). */
  suggestedMapping: Record<string, string | null>;
  layer: Pick<Layer, 'id' | 'name' | 'hasRole' | 'fields' | 'uniqueKeys' | 'addressFieldKey'>;
};

export type ImportStatusCounts = Record<ImportRowStatus, number> & { unresolvedDuplicates: number };

export type ImportStatusDto = ImportItem & {
  counts: ImportStatusCounts;
  /** Conteo de advertencias/errores por código, para los filtros de la revisión. */
  codeCounts: Record<string, number>;
  removals?: { total: number; toDelete: number; notDeletable: number };
  nextNumber?: { fieldKey: string; label: string; next: number } | null;
};

export type ImportRowDto = Jsonified<InferSelectModel<typeof s.importRows>> & {
  /** Registros existentes duplicados, con sus atributos, para comparar lado a lado. */
  existing?: { id: number; roleId: string | null; attributes: Record<string, unknown>; updatedAt: string }[];
};

export type ImportRemovalDto = Jsonified<InferSelectModel<typeof s.importRemovals>> & {
  record: { id: number; roleId: string | null; summary: SummaryItem[]; createdBy: string | null } | null;
};

export type ImportRevertResult = { deletedRecords: number; restoredRecords: number; reinsertedRecords: number };

// ---------- Auditoría / usuarios ----------
export type AuditLogDto = Jsonified<InferSelectModel<typeof s.auditLogs>>;

export type UserItem = {
  id: string;
  name: string;
  email: string;
  role: UserRole | null;
  lastSignInAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
};

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role | null;
  mustChangePassword: boolean;
};

export type { AuditAction, AuditEntity, CoordsSource, Department, GeocodeConfidence, ImportStatus, PolygonKind, RoleOperationType, UserRole };

export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; details?: unknown } };

/** Detalles de un `Conflict` por identidad repetida (§8.4), para el botón "Abrir registro existente". */
export type DuplicateConflictDetails = { kind: 'duplicate'; existingRecordId: number; identity: Record<string, string> };

// ---------- Administración de usuarios (fase 8) ----------
/** Respuesta de `GET /api/admin/users`: lista acotada por `limit/offset` con el total para paginar. */
export type UsersList = { data: UserItem[]; total: number };

// ---------- Importaciones (fase 7) ----------
/** `GET /api/imports/:id`: estado + resumen de la capa; `source` solo con `?source=1` (para retomar un borrador). */
export type ImportStatusFull = ImportStatusDto & {
  layer: ImportSource['layer'];
  /** Filas aún pendientes de geocodificación externa (`progress.pendingGeocode`). */
  pendingGeocode: number;
  source?: ImportSource;
};
