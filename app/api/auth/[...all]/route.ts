import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';
import { NotFoundError } from '@/server/errors';
import { toApiError } from '@/server/http';

const handler = toNextJsHandler(auth);

/**
 * Solo los endpoints de Better Auth que usa la interfaz. La gestión de usuarios pasa por
 * `/api/admin/users` y llama a `auth.api.*` en el servidor, sin este handler.
 * Lo demás (incluido lo que agregue una versión futura) responde 404.
 */
const allowed: Record<'GET' | 'POST', ReadonlySet<string>> = {
  GET: new Set(['/get-session']),
  POST: new Set(['/sign-in/email', '/sign-out', '/change-password', '/update-user']),
};

const PREFIX = '/api/auth';

function isAllowed(req: Request, method: 'GET' | 'POST'): boolean {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(`${PREFIX}/`)) return false;
  // Comparación exacta: mayúsculas, `%2F`, doble barra o barra final no calzan.
  return allowed[method].has(pathname.slice(PREFIX.length));
}

const notFound = () => toApiError(new NotFoundError());

export async function GET(req: Request): Promise<Response> {
  return isAllowed(req, 'GET') ? handler.GET(req) : notFound();
}

export async function POST(req: Request): Promise<Response> {
  return isAllowed(req, 'POST') ? handler.POST(req) : notFound();
}
