/**
 * Normalización del Rol SII (PROMPT.md §8.1). Función pura, sin dependencias.
 *
 *   '4631-30'      → '04631-00030'
 *   ' 12-3 '       → '00012-00003'
 *   'sin rol' / 's/rol' / '' / null → null
 *   'abc-12', '123', '1-2-3' → RoleIdInvalidError
 */

export class RoleIdInvalidError extends Error {
  readonly input: string;
  constructor(input: string) {
    super('Debe ser XXXXX-XXXXX con solo números');
    this.name = 'RoleIdInvalidError';
    this.input = input;
  }
}

const NO_ROLE_VALUES = new Set(['', 'sin rol', 's/rol', 's/ rol', 's/r', 'sr', '-', 'null', 'n/a', 'na']);

/** Aceptamos también separadores que los Excel municipales usan a veces en lugar del guion. */
const SEPARATORS = /[-–—−_/\s]+/;

export const ROLE_ID_REGEX = /^\d{5}-\d{5}$/;

export function normalizeRoleId(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (NO_ROLE_VALUES.has(trimmed.toLowerCase())) return null;

  const parts = trimmed.split(SEPARATORS).filter((p) => p.length > 0);
  if (parts.length !== 2) throw new RoleIdInvalidError(trimmed);

  const [left, right] = parts as [string, string];
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) throw new RoleIdInvalidError(trimmed);
  if (left.length > 5 || right.length > 5) throw new RoleIdInvalidError(trimmed);

  return `${left.padStart(5, '0')}-${right.padStart(5, '0')}`;
}

/** Variante que nunca lanza: devuelve `{ ok: false }` si el formato es inválido. */
export function tryNormalizeRoleId(
  input: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  try {
    return { ok: true, value: normalizeRoleId(input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Rol inválido' };
  }
}

/** ¿Lo escrito parece un rol (aunque esté incompleto)? Útil para la búsqueda (§8.6). */
export function looksLikeRoleId(input: string): boolean {
  const t = input.trim();
  return /^\d{1,5}(\s*[-–—/]\s*\d{0,5})?$/.test(t);
}

/** Alias de cabecera aceptados al importar (case/acento-insensible) (§8.1). */
export const ROLE_HEADER_ALIASES = ['roleid', 'rol', 'rol sii', 'rol_sii', 'rolsii', 'role', 'rol_id', 'rol id'];
