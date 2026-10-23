import type { MDXContent } from 'mdx/types';
import { capabilities } from '@/shared/capabilities';
import { helpSections, type HelpSectionId, type HelpSlug } from '@/shared/help-slugs';

/** Metadatos de una página del manual. Cada MDX exporta el mismo objeto como `meta` (§10.7). */
type HelpPageMeta = {
  title: string;
  section: HelpSectionId;
  order: number;
  draft: boolean;
};

type HelpPageEntry = {
  meta: HelpPageMeta;
  /** Import dinámico con ruta estática: Turbopack necesita conocer el archivo en tiempo de compilación. */
  load: () => Promise<{ default: MDXContent }>;
};

type HelpPage = HelpPageEntry & { slug: HelpSlug };

/**
 * Registro slug → página. Los `meta` se duplican aquí (y no se leen del MDX) para poder listar y ordenar las
 * páginas sin cargar los 24 módulos; `src/shared/help-slugs.test.ts` verifica que coincidan con cada archivo.
 */
export const helpRegistry: Record<HelpSlug, HelpPageEntry> = {
  'primeros-pasos': {
    meta: { title: 'Primeros pasos', section: 'inicio', order: 1, draft: false },
    load: () => import('./primeros-pasos.mdx'),
  },
  'ambiente-de-pruebas': {
    meta: { title: 'Ambiente de pruebas', section: 'inicio', order: 2, draft: false },
    load: () => import('./ambiente-de-pruebas.mdx'),
  },
  'mapa/navegacion': {
    meta: { title: 'Navegar el mapa', section: 'mapa', order: 1, draft: true },
    load: () => import('./mapa/navegacion.mdx'),
  },
  'mapa/busqueda': {
    meta: { title: 'Buscar', section: 'mapa', order: 2, draft: true },
    load: () => import('./mapa/busqueda.mdx'),
  },
  'mapa/ficha-del-rol': {
    meta: { title: 'Ficha del rol', section: 'mapa', order: 3, draft: true },
    load: () => import('./mapa/ficha-del-rol.mdx'),
  },
  'mapa/mapas-de-calor': {
    meta: { title: 'Mapas de calor', section: 'mapa', order: 4, draft: true },
    load: () => import('./mapa/mapas-de-calor.mdx'),
  },
  'mapa/poligonos': {
    meta: { title: 'Límites', section: 'mapa', order: 5, draft: true },
    load: () => import('./mapa/poligonos.mdx'),
  },
  'capas/crear-y-editar': {
    meta: { title: 'Crear y editar capas', section: 'capas', order: 1, draft: true },
    load: () => import('./capas/crear-y-editar.mdx'),
  },
  'capas/campos': {
    meta: { title: 'Campos de una capa', section: 'capas', order: 2, draft: true },
    load: () => import('./capas/campos.mdx'),
  },
  'capas/campos-unicos': {
    meta: { title: 'Campos únicos', section: 'capas', order: 3, draft: false },
    load: () => import('./capas/campos-unicos.mdx'),
  },
  'capas/correlativos': {
    meta: { title: 'Correlativos', section: 'capas', order: 4, draft: true },
    load: () => import('./capas/correlativos.mdx'),
  },
  'capas/direccion-y-valor': {
    meta: { title: 'Dirección y valor para mapas de calor', section: 'capas', order: 5, draft: true },
    load: () => import('./capas/direccion-y-valor.mdx'),
  },
  'registros/crear-y-editar': {
    meta: { title: 'Crear y editar registros', section: 'registros', order: 1, draft: true },
    load: () => import('./registros/crear-y-editar.mdx'),
  },
  'registros/asignar-numero': {
    meta: { title: 'Asignar el número de un permiso', section: 'registros', order: 2, draft: false },
    load: () => import('./registros/asignar-numero.mdx'),
  },
  'registros/coordenadas': {
    meta: { title: 'Ubicación de un registro', section: 'registros', order: 3, draft: true },
    load: () => import('./registros/coordenadas.mdx'),
  },
  'roles/operaciones': {
    meta: { title: 'Subdivisiones, fusiones y rectificaciones', section: 'roles', order: 1, draft: true },
    load: () => import('./roles/operaciones.mdx'),
  },
  'importacion/preparar-archivo': {
    meta: { title: 'Preparar el archivo', section: 'importacion', order: 1, draft: true },
    load: () => import('./importacion/preparar-archivo.mdx'),
  },
  'importacion/asistente': {
    meta: { title: 'Importar paso a paso', section: 'importacion', order: 2, draft: true },
    load: () => import('./importacion/asistente.mdx'),
  },
  'importacion/reemplazar-capa': {
    meta: { title: 'Volver a subir una planilla completa', section: 'importacion', order: 3, draft: true },
    load: () => import('./importacion/reemplazar-capa.mdx'),
  },
  'importacion/georreferenciacion': {
    meta: { title: 'Ubicación automática', section: 'importacion', order: 4, draft: true },
    load: () => import('./importacion/georreferenciacion.mdx'),
  },
  'importacion/revertir': {
    meta: { title: 'Historial y revertir', section: 'importacion', order: 5, draft: true },
    load: () => import('./importacion/revertir.mdx'),
  },
  exportacion: {
    meta: { title: 'Exportar', section: 'importacion', order: 6, draft: true },
    load: () => import('./exportacion.mdx'),
  },
  'administracion/usuarios': {
    meta: { title: 'Usuarios', section: 'administracion', order: 1, draft: true },
    load: () => import('./administracion/usuarios.mdx'),
  },
  'administracion/auditoria': {
    meta: { title: 'Auditoría', section: 'administracion', order: 2, draft: true },
    load: () => import('./administracion/auditoria.mdx'),
  },
  'administracion/padron-de-roles': {
    meta: { title: 'Padrón de roles', section: 'administracion', order: 3, draft: true },
    load: () => import('./administracion/padron-de-roles.mdx'),
  },
};

const sectionIndex = new Map<HelpSectionId, number>(helpSections.map((s, i) => [s.id, i]));

export function getHelpPage(slug: HelpSlug): HelpPage {
  return { slug, ...helpRegistry[slug] };
}

/** Páginas que solo aparecen en el índice del ambiente de pruebas (en producción siguen accesibles por URL). */
export const stagingOnlySlugs: readonly HelpSlug[] = ['ambiente-de-pruebas'];

/** Todas las páginas visibles, ordenadas por sección (orden de `helpSections`) y luego por `order`. */
export function listHelpPages(): HelpPage[] {
  return (Object.keys(helpRegistry) as HelpSlug[])
    .filter((slug) => capabilities.mode === 'staging' || !stagingOnlySlugs.includes(slug))
    .map((slug) => getHelpPage(slug))
    .sort((a, b) => {
      const bySection = (sectionIndex.get(a.meta.section) ?? 0) - (sectionIndex.get(b.meta.section) ?? 0);
      return bySection !== 0 ? bySection : a.meta.order - b.meta.order;
    });
}

/** Página anterior y siguiente en el orden de lectura del manual. */
export function prevNext(slug: HelpSlug): { prev: HelpPage | null; next: HelpPage | null } {
  const pages = listHelpPages();
  const i = pages.findIndex((p) => p.slug === slug);
  return {
    prev: i > 0 ? (pages[i - 1] ?? null) : null,
    next: i >= 0 && i < pages.length - 1 ? (pages[i + 1] ?? null) : null,
  };
}
