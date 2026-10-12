/**
 * Capacidades según el modo de despliegue (`NEXT_PUBLIC_DEPLOY_MODE`, ver docs/DEPLOY.md "Staging").
 * Única fuente de verdad para topes y avisos: la usan los servicios (que aplican la regla) y la interfaz
 * (que solo la refleja). `full` = producción con Docker; `staging` = Vercel + Neon, sin disco ni worker.
 */

export const deployModes = ['full', 'staging'] as const;
export type DeployMode = (typeof deployModes)[number];

export type Capabilities = {
  mode: DeployMode;
  /** Subir y descargar adjuntos de tipo archivo (los enlaces funcionan siempre). */
  fileAttachments: boolean;
  /** Tope de MB de una planilla a importar. `null` = el configurado en el servidor (`MAX_IMPORT_FILE_MB`). */
  importMaxMb: number | null;
  /** Máximo de filas con datos de una planilla. `null` = sin tope. */
  importMaxRows: number | null;
  /** Buscar en OpenStreetMap las direcciones que el padrón no ubicó (cola `import.geocode-external`). */
  externalGeocode: boolean;
  /** Cargar el padrón de roles desde la web (`POST /api/roles/import`). */
  padronUpload: boolean;
  /** Las tareas de importación corren dentro de la petición (`after()`) en vez del worker pg-boss. */
  inlineJobs: boolean;
  /** Dónde se guardan los archivos subidos. */
  fileStorage: 'disk' | 'database';
  /** Segundos tras los cuales un análisis sin terminar se da por interrumpido. `null` = nunca (el worker reintenta). */
  analysisStalledAfterSeconds: number | null;
  /** Textos para la interfaz y los errores (español de Chile, dicen qué pasa y qué hacer). */
  notices: {
    banner: string | null;
    attachments: string | null;
    padron: string | null;
    importLimits: string | null;
  };
};

/** Tope que la interfaz muestra en modo `full` (coincide con el valor por defecto de `MAX_IMPORT_FILE_MB`). */
export const DEFAULT_IMPORT_MAX_MB = 10;

const STAGING_IMPORT_MAX_MB = 4;
const STAGING_IMPORT_MAX_ROWS = 1000;
/** `maxDuration` de las rutas de importación (300 s) más un margen. */
const STAGING_STALLED_AFTER_SECONDS = 360;

const FULL: Capabilities = {
  mode: 'full',
  fileAttachments: true,
  importMaxMb: null,
  importMaxRows: null,
  externalGeocode: true,
  padronUpload: true,
  inlineJobs: false,
  fileStorage: 'disk',
  analysisStalledAfterSeconds: null,
  notices: { banner: null, attachments: null, padron: null, importLimits: null },
};

const STAGING: Capabilities = {
  mode: 'staging',
  fileAttachments: false,
  importMaxMb: STAGING_IMPORT_MAX_MB,
  importMaxRows: STAGING_IMPORT_MAX_ROWS,
  externalGeocode: false,
  padronUpload: false,
  inlineJobs: true,
  fileStorage: 'database',
  analysisStalledAfterSeconds: STAGING_STALLED_AFTER_SECONDS,
  notices: {
    banner: 'Ambiente de pruebas: no se pueden subir archivos y las importaciones son más pequeñas.',
    attachments:
      'En este ambiente de pruebas no se pueden subir archivos. Agrega un enlace al documento (por ejemplo, a Drive).',
    padron:
      'En este ambiente de pruebas el padrón de roles no se carga desde la web. Pide a un administrador técnico que lo cargue con el comando roles:import.',
    importLimits: 'Este es un ambiente de pruebas: los topes son menores que en la plataforma oficial y las direcciones solo se buscan en el padrón, no en OpenStreetMap.',
  },
};

/** Cualquier valor distinto de `staging` (incluida la variable ausente) es `full`. */
export function parseDeployMode(value: string | undefined | null): DeployMode {
  return value?.trim().toLowerCase() === 'staging' ? 'staging' : 'full';
}

export function capabilitiesFor(mode: DeployMode): Capabilities {
  return mode === 'staging' ? STAGING : FULL;
}

/**
 * Capacidades de este despliegue. `NEXT_PUBLIC_*` se fija en el build (Next la inserta en cliente y servidor);
 * en los scripts y el worker se lee en tiempo de ejecución.
 */
export const capabilities: Capabilities = capabilitiesFor(
  parseDeployMode(process.env.NEXT_PUBLIC_DEPLOY_MODE),
);

/**
 * ¿El análisis quedó cortado? Solo aplica cuando las tareas corren dentro de la petición: si la función se corta
 * a mitad, la importación queda en ANALYZING para siempre y hay que poder reintentarla o descartarla.
 */
export function isAnalysisStalled(
  imp: { status: string; progress: { startedAt?: string } | null },
  now: Date = new Date(),
  caps: Capabilities = capabilities,
): boolean {
  if (caps.analysisStalledAfterSeconds === null || imp.status !== 'ANALYZING') return false;
  const started = imp.progress?.startedAt ? Date.parse(imp.progress.startedAt) : NaN;
  // Sin marca de inicio (importación anterior a esta versión): se considera interrumpida.
  if (Number.isNaN(started)) return true;
  return now.getTime() - started > caps.analysisStalledAfterSeconds * 1000;
}
