import type { attachmentAllowedExtensions } from '@/shared/constants';

type AllowedExtension = (typeof attachmentAllowedExtensions)[number];

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const head = (buf: Uint8Array, n = 1024) => buf.subarray(0, Math.min(n, buf.length));
const latin1 = (buf: Uint8Array) => Buffer.from(buf).toString('latin1');
const UTF8_BOM = [0xef, 0xbb, 0xbf];

function isTiff(b: Uint8Array): boolean {
  // clásico (II*\0, MM\0*) y BigTIFF (II+\0, MM\0+)
  return [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
    [0x49, 0x49, 0x2b, 0x00],
    [0x4d, 0x4d, 0x00, 0x2b],
  ].some((sig) => startsWith(b, sig));
}

/** Tipo real de una imagen según su cabecera, o `null` si no es una de las permitidas. */
function detectImage(b: Uint8Array): string | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(b, ascii('GIF8'))) return 'image/gif';
  if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) return 'image/webp';
  if (isTiff(b)) return 'image/tiff';
  return null;
}

// Office: OLE2 (doc/xls/ppt y los nuevos con contraseña) o ZIP (docx/xlsx/pptx).
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const office = (mime: string) => (b: Uint8Array) => (startsWith(b, OLE2) || startsWith(b, ZIP) ? mime : null);

/** DXF de texto: sin bytes nulos y empieza (sin contar BOM ni espacios) con un grupo `0` / `SECTION` o un comentario `999`. */
function isTextDxf(b: Uint8Array): boolean {
  let h = head(b);
  if (startsWith(h, UTF8_BOM)) h = h.subarray(UTF8_BOM.length);
  if (h.includes(0)) return false;
  const lines = latin1(h)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return (lines[0] === '0' && lines[1]?.toUpperCase() === 'SECTION') || lines[0] === '999';
}

const when = (ok: (b: Uint8Array) => boolean, mime: string) => (b: Uint8Array) => (ok(b) ? mime : null);

/**
 * Por extensión: el tipo MIME que corresponde a los primeros bytes, o `null` si no calzan.
 * Las imágenes son una familia: un `.jpg` que en realidad es PNG o WebP se acepta con su tipo real.
 */
const detectors = new Map<string, (b: Uint8Array) => string | null>(
  Object.entries({
    // los lectores de PDF aceptan bytes antes de la cabecera
    pdf: when((b) => latin1(head(b)).includes('%PDF-'), 'application/pdf'),
    jpg: detectImage,
    jpeg: detectImage,
    png: detectImage,
    gif: detectImage,
    webp: detectImage,
    tif: detectImage,
    tiff: detectImage,
    doc: office('application/msword'),
    docx: office('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    xls: office('application/vnd.ms-excel'),
    xlsx: office('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ppt: office('application/vnd.ms-powerpoint'),
    pptx: office('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    dwg: when((b) => startsWith(b, ascii('AC10')), 'image/vnd.dwg'),
    dxf: when((b) => startsWith(b, ascii('AutoCAD Binary DXF')) || isTextDxf(b), 'image/vnd.dxf'),
  } satisfies Record<AllowedExtension, (b: Uint8Array) => string | null>),
);

/**
 * Tipo MIME a guardar para un archivo con esa extensión y esos primeros bytes, o `null` si el contenido
 * no corresponde a la extensión (o la extensión no está permitida). Es una revisión de cabecera, no un
 * análisis del archivo: cualquier ZIP pasa como `.docx`.
 */
export function detectContentType(ext: string, bytes: Uint8Array): string | null {
  return detectors.get(ext)?.(bytes) ?? null;
}
