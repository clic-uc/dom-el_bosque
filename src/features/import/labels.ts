import type { ImportMessageCode } from '@/shared/schemas/import-rows';
import type { ImportRowStatus } from '@/shared/schemas/imports';
import type { ImportSource } from '@/shared/types';

/** Textos del asistente de importación (§10.2), en español de Chile y sin jerga. */

export const STEPS = [
  { n: 1, label: 'Archivo' },
  { n: 2, label: 'Columnas' },
  { n: 3, label: 'Revisión' },
  { n: 4, label: 'Resultado' },
] as const;

export const rowStatusLabels: Record<ImportRowStatus, string> = {
  error: 'Con errores',
  duplicate: 'Duplicados',
  warning: 'Advertencias',
  valid: 'Listas',
  excluded: 'Excluidas',
};

export const rowStatusHelp: Record<ImportRowStatus, string> = {
  error:
    'Estas filas no se importarán hasta que corrijas el dato marcado. Puedes editar la celda aquí mismo o excluir la fila.',
  duplicate:
    'Ya existe un registro con los mismos datos de identificación. Elige qué hacer con cada fila o con todas a la vez.',
  warning:
    'Estas filas se importarán igual. Revisa las advertencias: puedes aceptar ubicaciones o roles sugeridos.',
  valid: 'Estas filas están listas para importarse sin observaciones.',
  excluded: 'Estas filas no se importarán. Puedes volver a incluirlas.',
};

export const codeLabels: Record<ImportMessageCode, string> = {
  role_invalid: 'Rol inválido',
  required_missing: 'Campo obligatorio vacío',
  type_invalid: 'Valor con formato incorrecto',
  coords_out_of_range: 'Coordenadas fuera de rango',
  autonumber_invalid: 'Correlativo inválido',
  duplicate_existing: 'Ya existe en la capa',
  duplicate_in_file: 'Repetido en el archivo',
  coords_outside_comuna: 'Fuera de la comuna',
  location_approx: 'Ubicación aproximada',
  location_missing: 'Sin ubicación',
  location_pending: 'Buscando dirección',
  role_assigned_by_address: 'Rol asignado por dirección',
  role_suggested_by_address: 'Rol sugerido por dirección',
  unique_keys_incomplete: 'Campos únicos incompletos',
  role_new: 'Rol nuevo (no está en el padrón)',
  role_superseded: 'Rol no vigente',
  role_has_records: 'El rol ya tiene registros',
  role_adopted_coords: 'El rol tomó las coordenadas',
};

export const phaseLabels: Record<string, string> = {
  queued: 'En espera…',
  preparing: 'Preparando el análisis…',
  analyzing: 'Analizando filas…',
  removals: 'Buscando registros que no vienen en el archivo…',
  review: 'Análisis terminado',
  writing: 'Guardando registros…',
  deleting: 'Eliminando registros marcados…',
  completed: 'Importación completada',
  failed: 'Falló',
};

export const MAPPING_SPECIAL = {
  roleId: 'Rol SII',
  lat: 'Latitud',
  lon: 'Longitud',
  comments: 'Comentarios',
} as const;

export const IGNORE = '__ignore__';

export function targetLabel(layer: ImportSource['layer'], target: string | null): string {
  if (!target) return 'Ignorar';
  if (target in MAPPING_SPECIAL) return MAPPING_SPECIAL[target as keyof typeof MAPPING_SPECIAL];
  return layer.fields.find((f) => f.key === target)?.label ?? target;
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString('es-CL')} ${n === 1 ? singular : pluralForm}`;
}
