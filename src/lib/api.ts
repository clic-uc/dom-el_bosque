import type { ApiErrorBody, ApiErrorCode, NumberedRecordsDetails } from '@/shared/types';

/** Error de API en el cliente, con el mensaje en español que envió el servidor. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];
export type QueryParams = Record<string, QueryValue | Record<string, string | string[]>>;

/** Serializa params: arrays como claves repetidas, `filters` como `filters[k]=v`. */
export function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'filters' && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        const vals = Array.isArray(v) ? v : [v];
        for (const x of vals) sp.append(`filters[${k}]`, x);
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, String(v));
      continue;
    }
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export type ApiInit = Omit<RequestInit, 'body'> & {
  json?: unknown;
  body?: BodyInit | null;
  query?: QueryParams;
};

function isApiErrorBody(x: unknown): x is ApiErrorBody {
  return typeof x === 'object' && x !== null && 'error' in x && typeof (x as ApiErrorBody).error?.message === 'string';
}

/**
 * Wrapper de `fetch` para la API same-origin. Lanza `ApiError` con el mensaje del servidor.
 * 401 → vuelve al ingreso; 403 PASSWORD_CHANGE_REQUIRED → pantalla de cambio de contraseña.
 */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, query, headers, ...rest } = init;
  const url = `${path}${buildQuery(query)}`;
  const res = await fetch(url, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const body: ApiErrorBody['error'] = isApiErrorBody(payload)
      ? payload.error
      : { code: res.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL', message: defaultMessage(res.status) };
    // Recarga completa a propósito: la sesión cambió de estado y el shell del servidor debe revalidarla.
    if (typeof window !== 'undefined') {
      if (res.status === 401 && !window.location.pathname.startsWith('/api')) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      } else if (body.code === 'PASSWORD_CHANGE_REQUIRED' && window.location.pathname !== '/account/password') {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/account/password';
      }
    }
    throw new ApiError(res.status, body);
  }

  return payload as T;
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Debes iniciar sesión';
  if (status === 403) return 'No tienes permiso para hacer esto';
  if (status === 404) return 'No encontramos lo que buscabas';
  if (status === 413) return 'El archivo es demasiado grande';
  if (status === 429) return 'Demasiadas solicitudes. Espera un momento e intenta de nuevo';
  return 'Ocurrió un error inesperado. Intenta de nuevo en unos minutos';
}

/**
 * La operación haría perder números asignados por la plataforma y falta el motivo (§8.8): la UI pide el
 * motivo y reenvía la misma operación con `reason`. No se muestra como error.
 */
export function isReasonRequired(err: unknown): err is ApiError & { details: NumberedRecordsDetails } {
  return (
    err instanceof ApiError &&
    err.code === 'VALIDATION' &&
    typeof err.details === 'object' &&
    err.details !== null &&
    (err.details as { reasonRequired?: boolean }).reasonRequired === true
  );
}

/** Mensaje de error para mostrar en toasts / formularios. */
export function errorMessage(err: unknown, fallback = 'Ocurrió un error. Intenta de nuevo.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
