const BASE = 'http://sigdom.invalid';

/**
 * Destino tras el ingreso (`?next=`): solo rutas internas. Cualquier otra cosa vuelve a `fallback`.
 * Rechaza lo que un navegador podría leer como otro sitio (`//x`, `/\x`, caracteres de control) y
 * confirma, al resolverla, que la URL no sale del origen.
 */
export function safeNextPath(next: unknown, fallback = '/map'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback;
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
  return url.pathname + url.search + url.hash;
}
