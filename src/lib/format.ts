/** Formato de fechas y números para la UI (es-CL). */

const dateFmt = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const numberFmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `2024-03-12` o ISO → `12-03-2024`. */
export function formatDate(v: string | Date | null | undefined): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}-${m}-${y}`;
  }
  const d = toDate(v);
  return d ? dateFmt.format(d).replace(/\//g, '-') : '';
}

export function formatDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? dateTimeFmt.format(d).replace(/\//g, '-').replace(',', '') : '';
}

export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? '' : numberFmt.format(n);
}

export function formatInt(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? '' : intFmt.format(n);
}

export function formatCoord(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : n.toFixed(6);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Valor de un atributo según el tipo de campo, para mostrar en tablas y fichas. */
export function formatFieldValue(
  value: unknown,
  type: 'string' | 'number' | 'boolean' | 'date' | 'autonumber',
): string {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'number':
      return typeof value === 'number' ? formatNumber(value) : String(value);
    case 'autonumber':
      return typeof value === 'number' ? formatInt(value) : String(value);
    case 'boolean':
      return value === true ? 'Sí' : value === false ? 'No' : String(value);
    case 'date':
      return formatDate(String(value));
    default:
      return String(value);
  }
}

/** "hace 5 minutos", "ayer", etc. */
export function formatRelative(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '';
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es-CL', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(d);
}
