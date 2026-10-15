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
  // `/map` a secas no necesita destino (es el de por defecto); con query sí, para no perder la capa o el registro.
  const target = pathname + request.nextUrl.search;
  url.search = target !== '/map' ? `?next=${encodeURIComponent(target)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  // Los estáticos de `public/` (incluido el worker de MapLibre) no pasan por el chequeo de sesión.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo_el_bosque.png|.*\\.(?:png|jpg|jpeg|svg|ico|webp|js|mjs|css|map|woff2?)$).*)',
  ],
};
