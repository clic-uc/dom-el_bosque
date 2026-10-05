import type { FieldType } from '@/shared/constants';
import type { LayerField } from '@/shared/schemas/layers';

/**
 * Casteo de valores según el tipo del campo (§5.4). Pura, con tests.
 *  - number: acepta "1.234,5" y "1234.5" (y "1,234.5")
 *  - autonumber: entero positivo
 *  - boolean: true/false/'sí'/'no'/'si'/'s'/'n'/'1'/'0'/'x'
 *  - date: ISO 'YYYY-MM-DD' aceptando dd-mm-aaaa, dd/mm/aaaa, aaaa/mm/dd, Date y seriales de Excel
 *  - vacío → null
 */

export type CastResult = { ok: true; value: unknown } | { ok: false; error: string };

const TRUE_WORDS = new Set(['true', 'si', 'sí', 's', 'y', 'yes', '1', 'x', 'verdadero', 'ok']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'falso', '']);

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export function parseNumberCl(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/\s+/g, '').replace(/^\$/, '');
  if (s === '') return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // el último separador es el decimal
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    // "1,234" con exactamente 3 dígitos tras la coma única es ambiguo: lo tratamos como decimal (es-CL)
    s = parts.length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot) {
    const parts = s.split('.');
    // "1.234.567" → miles; "1.234" (una sola, 3 dígitos) → en es-CL casi siempre miles
    if (parts.length > 2) s = s.replace(/\./g, '');
    else if (parts.length === 2 && parts[1]!.length === 3 && parts[0]!.length <= 3) s = s.replace('.', '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Serial de fecha de Excel (días desde 1899-12-30) → ISO. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Math.round((serial - 25_569) * 86_400_000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1800 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function parseDateToIso(input: unknown): string | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString().slice(0, 10);
  }
  if (typeof input === 'number') return excelSerialToIso(input);
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (s === '') return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/.exec(s);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/.exec(s);
  if (m) {
    const yy = Number(m[3]);
    return validYmd(yy < 50 ? 2000 + yy : 1900 + yy, Number(m[2]), Number(m[1]));
  }

  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));

  return null;
}

export function parseBoolean(input: unknown): boolean | null | undefined {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'number') return input !== 0;
  if (typeof input !== 'string') return undefined;
  const s = input.trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return s === '' ? null : false;
  return undefined;
}

/** Castea un valor crudo al tipo del campo. */
export function castValue(input: unknown, type: FieldType): CastResult {
  if (isEmptyValue(input)) return { ok: true, value: null };

  switch (type) {
    case 'string': {
      if (input instanceof Date) return { ok: true, value: input.toISOString().slice(0, 10) };
      return { ok: true, value: String(input).trim() };
    }
    case 'number': {
      const n = parseNumberCl(input);
      return n === null ? { ok: false, error: `"${String(input)}" no es un número` } : { ok: true, value: n };
    }
    case 'autonumber': {
      const n = parseNumberCl(input);
      if (n === null || !Number.isInteger(n) || n <= 0) {
        return { ok: false, error: `"${String(input)}" no es un número entero positivo` };
      }
      return { ok: true, value: n };
    }
    case 'boolean': {
      const b = parseBoolean(input);
      if (b === undefined) return { ok: false, error: `"${String(input)}" no se entiende como Sí o No` };
      return { ok: true, value: b };
    }
    case 'date': {
      const iso = parseDateToIso(input);
      return iso === null
        ? { ok: false, error: `"${String(input)}" no es una fecha válida (usa dd-mm-aaaa)` }
        : { ok: true, value: iso };
    }
  }
}

export type CastAttributesResult = {
  attributes: Record<string, unknown>;
  errors: { key: string; label: string; message: string }[];
  /** claves presentes en la entrada que no pertenecen a la capa (se descartan) */
  unknownKeys: string[];
};

/**
 * Filtra claves desconocidas y castea según `fields` (§5.4). `autonumber` solo se acepta si `allowAutonumber`
 * (importación de números históricos); en formularios se ignora.
 */
export function castAttributes(
  raw: Record<string, unknown>,
  fields: LayerField[],
  opts: { allowAutonumber?: boolean } = {},
): CastAttributesResult {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const attributes: Record<string, unknown> = {};
  const errors: CastAttributesResult['errors'] = [];
  const unknownKeys: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    const field = byKey.get(key);
    if (!field) {
      unknownKeys.push(key);
      continue;
    }
    if (field.type === 'autonumber' && !opts.allowAutonumber) continue;
    const r = castValue(value, field.type);
    if (r.ok) attributes[key] = r.value;
    else errors.push({ key, label: field.label, message: r.error });
  }

  return { attributes, errors, unknownKeys };
}

/** Comprueba cuántos valores existentes se pueden convertir a otro tipo (§7.2). */
export function previewTypeConversion(
  values: unknown[],
  toType: FieldType,
): { convertible: number; notConvertible: number; samples: unknown[] } {
  let convertible = 0;
  let notConvertible = 0;
  const samples: unknown[] = [];
  for (const v of values) {
    if (isEmptyValue(v)) continue;
    const r = castValue(v, toType);
    if (r.ok) convertible++;
    else {
      notConvertible++;
      if (samples.length < 5) samples.push(v);
    }
  }
  return { convertible, notConvertible, samples };
}
