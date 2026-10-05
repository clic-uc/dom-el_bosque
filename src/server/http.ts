import { NextResponse, type NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import type { Role } from '@/shared/permissions';
import { getActor, type Actor, type GetActorOptions } from './auth/session';
import { ForbiddenError, toApiError, zodToValidationError } from './errors';

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
