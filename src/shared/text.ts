/** Utilidades de texto puras, compartidas entre cliente y servidor. */

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Minúsculas, sin acentos, espacios colapsados: la forma canónica para comparar textos (§8.4). */
export function normalizeText(s: string): string {
  return stripAccents(String(s)).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** `'N° Permiso'` → `'n_permiso'` (§5.2). */
export function toFieldKey(label: string): string {
  const base = stripAccents(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  const key = /^[a-z]/.test(base) ? base : `c_${base}`;
  return key.slice(0, 80) || 'campo';
}

/** `'Obras Menores'` → `'obras-menores'`. */
export function slugify(name: string): string {
  const base = stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return base.slice(0, 80) || 'capa';
}

/** Devuelve `base`, o `base_2`, `base_3`… hasta que no choque con `taken`. */
export function uniqueSuffix(base: string, taken: Iterable<string>, sep = '_'): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}${sep}${i}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base}${sep}${Date.now()}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase() || '?';
}

/** Formato chileno de miles: 6124 → '6.124'. */
export function formatNumberCl(n: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: maxFractionDigits }).format(n);
}
