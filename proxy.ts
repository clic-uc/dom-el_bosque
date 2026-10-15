import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Chequeo optimista de sesión (§6.1): solo mira si existe la cookie. La validación real
 * ocurre siempre en `getActor()`. En Next 16 este archivo reemplaza a `middleware.ts`.
 */
const PUBLIC_PATHS = ['/', '/api/health'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const hasSession = !!getSessionCookie(request);
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Debes iniciar sesión' } },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/';
  url.search = pathname !== '/map' ? `?next=${encodeURIComponent(pathname + request.nextUrl.search)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  // Los estáticos de `public/` (incluido el worker de MapLibre) no pasan por el chequeo de sesión.
  // Las tres rutas de subida tampoco: con proxy, Next copia el cuerpo entero en memoria antes de la ruta
  // (y corta en 10 MB). Ellas mismas exigen sesión (`withActor`) y rechazan por tamaño antes de leer.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo_el_bosque.png|api/attachments$|api/imports$|api/roles/import$|.*\\.(?:png|jpg|jpeg|svg|ico|webp|js|mjs|css|map|woff2?)$).*)',
  ],
};
