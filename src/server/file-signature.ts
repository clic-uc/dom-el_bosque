import type { attachmentAllowedExtensions } from '@/shared/constants';

type AllowedExtension = (typeof attachmentAllowedExtensions)[number];

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const head = (buf: Uint8Array, n = 1024) => buf.subarray(0, Math.min(n, buf.length));
const latin1 = (buf: Uint8Array) => Buffer.from(buf).toString('latin1');

// Office: OLE2 (doc/xls/ppt y los nuevos con contraseña) o ZIP (docx/xlsx/pptx).
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const office = (b: Uint8Array) => startsWith(b, OLE2) || startsWith(b, ZIP);

/** DXF de texto: sin bytes nulos y empieza (sin contar espacios) con un grupo `0` / `SECTION` o un comentario `999`. */
function isTextDxf(b: Uint8Array): boolean {
  const h = head(b);
  if (h.includes(0)) return false;
  const lines = latin1(h)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return (lines[0] === '0' && lines[1]?.toUpperCase() === 'SECTION') || lines[0] === '999';
}

const checks: Record<AllowedExtension, (b: Uint8Array) => boolean> = {
  // los lectores de PDF aceptan bytes antes de la cabecera
  pdf: (b) => latin1(head(b)).includes('%PDF-'),
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]),
  gif: (b) => startsWith(b, ascii('GIF8')),
  webp: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  tif: isTiff,
  tiff: isTiff,
  doc: office,
  docx: office,
  xls: office,
  xlsx: office,
  ppt: office,
  pptx: office,
  dwg: (b) => startsWith(b, ascii('AC10')),
  dxf: (b) => startsWith(b, ascii('AutoCAD Binary DXF')) || isTextDxf(b),
};

function isTiff(b: Uint8Array): boolean {
  // clásico (II*\0, MM\0*) y BigTIFF (II+\0, MM\0+)
  return [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
    [0x49, 0x49, 0x2b, 0x00],
    [0x4d, 0x4d, 0x00, 0x2b],
  ].some((sig) => startsWith(b, sig));
}

/** ¿Los primeros bytes corresponden al tipo que dice la extensión? Extensión desconocida: `false`. */
export function matchesExtension(ext: string, bytes: Uint8Array): boolean {
  const check = checks[ext as AllowedExtension];
  return check ? check(bytes) : false;
}
