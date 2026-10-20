const BASE = 'http://sigdom.invalid';

const isInternalPath = (path: string) =>
  path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');

/**
 * Destino tras el ingreso (`?next=`): solo rutas internas. Cualquier otra cosa vuelve a `fallback`.
 * Rechaza lo que un navegador podría leer como otro sitio (`//x`, `/\x`, caracteres de control) y
 * confirma, al resolverla y otra vez ya normalizada, que la URL no sale del origen.
 */
export function safeNextPath(next: unknown, fallback = '/map'): string {
  if (typeof next !== 'string' || !isInternalPath(next)) return fallback;
  for (const ch of next) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || code < 0x20 || code === 0x7f) return fallback;
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // Se revisa de nuevo tras normalizar: los puntos (`/.//x`, `/%2e%2e//x`) pueden dejar `//x`, que es otro sitio.
  const path = url.pathname + url.search + url.hash;
  return isInternalPath(path) ? path : fallback;
}
