/** Lista tipada de páginas del manual (§10.7). `HelpLink` solo acepta estos slugs; un test verifica que cada uno tenga su MDX. */
export const helpSlugs = [
  'primeros-pasos',
  'ambiente-de-pruebas',
  'mapa/navegacion',
  'mapa/busqueda',
  'mapa/ficha-del-rol',
  'roles/operaciones',
  'mapa/mapas-de-calor',
  'mapa/poligonos',
  'capas/crear-y-editar',
  'capas/campos',
  'capas/campos-unicos',
  'capas/correlativos',
  'capas/direccion-y-valor',
  'registros/crear-y-editar',
  'registros/asignar-numero',
  'registros/coordenadas',
  'importacion/preparar-archivo',
  'importacion/asistente',
  'importacion/reemplazar-capa',
  'importacion/georreferenciacion',
  'importacion/revertir',
  'exportacion',
  'administracion/usuarios',
  'administracion/auditoria',
  'administracion/padron-de-roles',
] as const;

export type HelpSlug = (typeof helpSlugs)[number];

export const helpSections = [
  { id: 'inicio', title: 'Para empezar' },
  { id: 'mapa', title: 'El mapa' },
  { id: 'capas', title: 'Capas' },
  { id: 'registros', title: 'Registros' },
  { id: 'roles', title: 'Roles' },
  { id: 'importacion', title: 'Importar y exportar' },
  { id: 'administracion', title: 'Administración' },
] as const;

export type HelpSectionId = (typeof helpSections)[number]['id'];

export function isHelpSlug(s: string): s is HelpSlug {
  return (helpSlugs as readonly string[]).includes(s);
}
