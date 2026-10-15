import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import type { Role } from '@/shared/permissions';
import { getActor, type Actor, type GetActorOptions } from './auth/session';
import {
  AppError,
  ForbiddenError,
  statusFromText,
  ValidationError,
  zodToValidationError,
  type ApiErrorBody,
  type ApiErrorCode,
} from './errors';
import { logger } from './logger';

/** Único punto de mapeo error → respuesta HTTP (§3.2 punto 13). */
export function toApiError(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof AppError) {
    return NextResponse.json(err.toBody(), { status: err.status });
  }
  if (err instanceof ZodError) {
    const v = zodToValidationError(err);
    return NextResponse.json(v.toBody(), { status: v.status });
  }
  // Errores de Better Auth (APIError) traen `status` y `body.message`
  if (typeof err === 'object' && err !== null && 'status' in err && 'body' in err) {
    const e = err as { status: string | number; body?: { message?: string; code?: string } };
    const status = typeof e.status === 'number' ? e.status : statusFromText(String(e.status));
    const code: ApiErrorCode =
      status === 401
        ? 'UNAUTHORIZED'
        : status === 403
          ? 'FORBIDDEN'
          : status === 404
            ? 'NOT_FOUND'
            : status === 409
              ? 'CONFLICT'
              : status === 429
                ? 'RATE_LIMITED'
                : status >= 500
                  ? 'INTERNAL'
                  : 'VALIDATION';
    return NextResponse.json(
      { error: { code, message: e.body?.message ?? 'Error de autenticación', details: e.body?.code } },
      { status },
    );
  }
  logger.error({ err }, 'Error no controlado');
  return NextResponse.json(
    {
      error: { code: 'INTERNAL', message: 'Ocurrió un error inesperado. Intenta de nuevo en unos minutos.' },
    },
    { status: 500 },
  );
}

/**
 * Helpers para Route Handlers (§7): parsear con Zod → llamar al servicio → serializar.
 * Next 16 entrega `params` como Promise.
 */

export type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

export type HandlerArgs<P extends Record<string, string>> = {
  req: NextRequest;
  params: P;
  actor: Actor;
};

export type HandlerOptions = GetActorOptions & {
  /** Roles permitidos. Por defecto cualquier usuario autenticado (viewer incluido). */
  roles?: readonly Role[];
};

/** Envuelve un handler autenticado: resuelve actor, valida rol y mapea errores a JSON uniforme. */
export function withActor<P extends Record<string, string> = Record<string, string>>(
  fn: (args: HandlerArgs<P>) => Promise<Response>,
  opts: HandlerOptions = {},
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      const actor = await getActor(opts);
      if (opts.roles && !opts.roles.includes(actor.role)) throw new ForbiddenError();
      const params = await ctx.params;
      return await fn({ req, params, actor });
    } catch (err) {
      return toApiError(err);
    }
  };
}

/** Handler público (sin sesión). */
export function withPublic<P extends Record<string, string> = Record<string, string>>(
  fn: (args: { req: NextRequest; params: P }) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      const params = await ctx.params;
      return await fn({ req, params });
    } catch (err) {
      return toApiError(err);
    }
  };
}

/** Margen sobre el tamaño del archivo para el resto del multipart (campos y separadores). */
const MULTIPART_MARGIN_BYTES = 1024 * 1024;

/**
 * Rechaza una subida por su `Content-Length`, antes de leer el cuerpo: un archivo enorme no llega a memoria.
 * Sin `Content-Length` también se rechaza (el navegador siempre lo envía en un formulario con archivo).
 * Las rutas que la usan quedan fuera del `matcher` de `proxy.ts`: si no, Next copia el cuerpo entero antes.
 */
export function assertBodySize(req: Request, maxBytes: number, message: string): void {
  // Un tope mal configurado (p. ej. NaN si falta la variable y se omitió la validación de env) no deja pasar nada.
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error(`Tope de subida inválido: ${maxBytes}`);
  const header = req.headers.get('content-length');
  const length = header === null ? NaN : Number(header);
  if (!Number.isFinite(length) || length < 0) {
    throw new ValidationError('No se pudo leer el tamaño del archivo. Vuelve a subirlo desde la plataforma.');
  }
  if (length > maxBytes + MULTIPART_MARGIN_BYTES) throw new ValidationError(message);
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw zodToValidationError(result.error);
  return result.data;
}

/**
 * Convierte los search params en un objeto: claves repetidas → array; `filters[k]=v` → `filters: { k: [v] }`.
 */
export function searchParamsToObject(sp: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const filters: Record<string, string[]> = {};
  for (const [key, value] of sp.entries()) {
    const m = /^filters\[(.+)\]$/.exec(key);
    if (m?.[1]) {
      (filters[m[1]] ??= []).push(value);
      continue;
    }
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  if (Object.keys(filters).length) out.filters = filters;
  return out;
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const result = schema.safeParse(searchParamsToObject(req.nextUrl.searchParams));
  if (!result.success) throw zodToValidationError(result.error);
  return result.data;
}

export function parseParams<T>(params: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(params);
  if (!result.success) throw zodToValidationError(result.error);
  return result.data;
}

export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function created<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 201 });
}

export function accepted<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 202 });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export const privateNoStore = { 'Cache-Control': 'private, no-store' } as const;
