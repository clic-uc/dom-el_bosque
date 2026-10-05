/** Constantes compartidas entre cliente y servidor (PROMPT.md §0 y §5.1). */

export const APP_NAME = 'SIGDOM El Bosque';
export const APP_SHORT_NAME = 'Georreferenciación DOM';

export const departments = ['edificacion', 'ejecucion', 'emergencias', 'vivienda'] as const;
export type Department = (typeof departments)[number];

export const departmentLabels: Record<Department, string> = {
  edificacion: 'Edificación y Urbanismo',
  ejecucion: 'Ejecución de Obras',
  emergencias: 'Emergencias',
  vivienda: 'Vivienda',
};

export const userRoles = ['admin', 'editor', 'viewer'] as const;
export type UserRole = (typeof userRoles)[number];

export const userRoleLabels: Record<UserRole | 'none', string> = {
  admin: 'Administrador',
  editor: 'Editor',
  viewer: 'Visor',
  none: 'Sin rol',
};

export const fieldTypes = ['string', 'number', 'boolean', 'date', 'autonumber'] as const;
export type FieldType = (typeof fieldTypes)[number];

export const fieldTypeLabels: Record<FieldType, string> = {
  string: 'Texto',
  number: 'Número',
  boolean: 'Sí / No',
  date: 'Fecha',
  autonumber: 'Correlativo',
};

export const fieldTypeDescriptions: Record<FieldType, string> = {
  string: 'Cualquier texto: nombres, direcciones, observaciones.',
  number: 'Solo números, como metros cuadrados o montos.',
  boolean: 'Una casilla que se marca o no.',
  date: 'Una fecha del calendario.',
  autonumber: 'Número que la plataforma asigna en orden, sin repetir (por ejemplo, N° Permiso).',
};

export const geocodeConfidences = ['exact', 'interpolated', 'approx', 'street'] as const;
export type GeocodeConfidence = (typeof geocodeConfidences)[number];

export const geocodeConfidenceLabels: Record<GeocodeConfidence, string> = {
  exact: 'Dirección exacta',
  interpolated: 'Estimada entre números vecinos',
  approx: 'Dirección parecida',
  street: 'Solo la calle',
};

export const coordsSources = ['role', 'own', 'geocoded'] as const;
export type CoordsSource = (typeof coordsSources)[number];

export const coordsSourceLabels: Record<CoordsSource, string> = {
  role: 'Del rol',
  own: 'Propias',
  geocoded: 'Aproximadas por dirección',
};

export const roleOperationTypes = ['subdivision', 'fusion', 'rectificacion', 'modificacion'] as const;
export type RoleOperationType = (typeof roleOperationTypes)[number];

export const roleOperationTypeLabels: Record<RoleOperationType, string> = {
  subdivision: 'Subdivisión',
  fusion: 'Fusión',
  rectificacion: 'Rectificación',
  modificacion: 'Modificación',
};

export const roleOperationTypeDescriptions: Record<RoleOperationType, string> = {
  subdivision: 'Un predio se divide en dos o más. El rol original deja de estar vigente.',
  fusion: 'Dos o más predios se unen en uno. Los roles originales dejan de estar vigentes.',
  rectificacion: 'Se corrige el número del rol. El rol anterior deja de estar vigente.',
  modificacion: 'Una anotación sobre el rol. Sigue vigente.',
};

export const importStatuses = [
  'UPLOADED',
  'ANALYZING',
  'REVIEW',
  'COMMITTING',
  'COMPLETED',
  'FAILED',
  'DISCARDED',
  'REVERTED',
] as const;
export type ImportStatus = (typeof importStatuses)[number];

export const importStatusLabels: Record<ImportStatus, string> = {
  UPLOADED: 'Borrador',
  ANALYZING: 'Analizando',
  REVIEW: 'En revisión',
  COMMITTING: 'Guardando',
  COMPLETED: 'Completada',
  FAILED: 'Fallida',
  DISCARDED: 'Descartada',
  REVERTED: 'Revertida',
};

export const auditActions = ['CREATE', 'UPDATE', 'DELETE', 'IMPORT', 'REVERT', 'ASSIGN_NUMBER'] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditActionLabels: Record<AuditAction, string> = {
  CREATE: 'Creación',
  UPDATE: 'Edición',
  DELETE: 'Eliminación',
  IMPORT: 'Importación',
  REVERT: 'Reversión',
  ASSIGN_NUMBER: 'Asignación de número',
};

export const auditEntities = [
  'LAYER',
  'RECORD',
  'ROLE',
  'ROLE_OPERATION',
  'USER',
  'POLYGON',
  'ATTACHMENT',
  'IMPORT',
] as const;
export type AuditEntity = (typeof auditEntities)[number];

export const auditEntityLabels: Record<AuditEntity, string> = {
  LAYER: 'Capa',
  RECORD: 'Registro',
  ROLE: 'Rol',
  ROLE_OPERATION: 'Operación de rol',
  USER: 'Usuario',
  POLYGON: 'Polígono',
  ATTACHMENT: 'Adjunto',
  IMPORT: 'Importación',
};

export const polygonKinds = ['comuna', 'sector', 'villa'] as const;
export type PolygonKind = (typeof polygonKinds)[number];

export const polygonKindLabels: Record<PolygonKind, string> = {
  comuna: 'Comuna',
  sector: 'Sectores',
  villa: 'Villas / Poblaciones',
};

export const polygonStyles: Record<PolygonKind, { line: string; width: number; opacity: number; fillOpacity: number }> =
  {
    comuna: { line: '#73308a', width: 3, opacity: 0.8, fillOpacity: 0.06 },
    sector: { line: '#3B82F6', width: 2, opacity: 0.7, fillOpacity: 0.08 },
    villa: { line: '#10B981', width: 2, opacity: 0.7, fillOpacity: 0.08 },
  };

/** Área geográfica de la comuna (PROMPT.md §0). */
export const MAP_CENTER = { lat: -33.56056, lon: -70.66144 } as const;
export const MAP_INITIAL_ZOOM = 14;
export const COMUNA_BOUNDS = {
  minLon: -70.7586,
  maxLon: -70.64506,
  minLat: -33.59221,
  maxLat: -33.53141,
} as const;
/** Margen para advertir (no rechazar) coordenadas fuera de la comuna (§8.2). */
export const COMUNA_BOUNDS_MARGIN = 0.05;
/** Margen para `maxBounds` del mapa (§10.2). */
export const MAP_MAX_BOUNDS_MARGIN = 0.1;

export const DEFAULT_LAYER_ICON = 'building-2';
export const DEFAULT_LAYER_ICON_COLOR = '#3b82f6';

export const iconPalette = [
  { name: 'Gris', hex: '#6b7280' },
  { name: 'Azul', hex: '#3b82f6' },
  { name: 'Verde', hex: '#10b981' },
  { name: 'Rojo', hex: '#ef4444' },
  { name: 'Amarillo', hex: '#f59e0b' },
  { name: 'Púrpura', hex: '#8b5cf6' },
  { name: 'Rosa', hex: '#ec4899' },
  { name: 'Índigo', hex: '#6366f1' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Naranja', hex: '#f97316' },
  { name: 'Cian', hex: '#06b6d4' },
  { name: 'Lima', hex: '#84cc16' },
] as const;

/** Claves que no pueden usarse como `key` de un campo (§5.2). */
export const RESERVED_FIELD_KEYS = ['id', 'roleId', 'lat', 'lon', 'comments'] as const;

export const MAX_OVERLAY_LAYERS = 6;
export const MAX_LAYER_FIELDS = 60;

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const IMPORT_DRAFT_TTL_DAYS = 7;

export const attachmentAllowedMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/vnd.dwg',
  'application/acad',
  'application/x-acad',
  'application/dxf',
  'image/vnd.dxf',
  'application/octet-stream', // DWG/DXF suelen llegar así; se valida además por extensión
] as const;

export const attachmentAllowedExtensions = [
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'tif',
  'tiff',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'dwg',
  'dxf',
] as const;
