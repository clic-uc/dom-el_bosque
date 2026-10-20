import { describe, expect, it } from 'vitest';
import { attachmentAllowedExtensions } from '@/shared/constants';
import { detectContentType } from './file-signature';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));

const EXE = bytes('MZ', [0x90, 0x00, 0x03, 0x00]);
const HTML = bytes('<!DOCTYPE html><html><body><table></table></body></html>');

const valid: Record<string, Uint8Array[]> = {
  pdf: [bytes('%PDF-1.7\n'), bytes([0xef, 0xbb, 0xbf], '\n%PDF-1.4')],
  jpg: [bytes([0xff, 0xd8, 0xff, 0xe0])],
  jpeg: [bytes([0xff, 0xd8, 0xff, 0xe1])],
  png: [bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  gif: [bytes('GIF89a')],
  webp: [bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ')],
  tif: [bytes('II*', [0])],
  tiff: [bytes('MM', [0], '*'), bytes('II+', [0])],
  doc: [bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  docx: [bytes('PK', [3, 4]), bytes([0xd0, 0xcf, 0x11, 0xe0])],
  xls: [bytes([0xd0, 0xcf, 0x11, 0xe0])],
  xlsx: [bytes('PK', [3, 4])],
  ppt: [bytes([0xd0, 0xcf, 0x11, 0xe0])],
  pptx: [bytes('PK', [3, 4])],
  dwg: [bytes('AC1032')],
  dxf: [
    bytes('  0\r\nSECTION\r\n  2\r\nHEADER\r\n'),
    bytes('999\nhecho a mano\n  0\nSECTION\n'),
    bytes('AutoCAD Binary DXF\r\n', [0x1a, 0]),
    // guardado como «UTF-8 con BOM» por algunos editores
    bytes([0xef, 0xbb, 0xbf], '  0\r\nSECTION\r\n'),
  ],
};

const matches = (ext: string, b: Uint8Array) => detectContentType(ext, b) !== null;

describe('detectContentType', () => {
  it('cubre todas las extensiones permitidas', () => {
    expect(Object.keys(valid).sort()).toEqual([...attachmentAllowedExtensions].sort());
  });

  it('acepta el contenido que corresponde a la extensión', () => {
    for (const [ext, samples] of Object.entries(valid)) {
      for (const s of samples) expect(matches(ext, s), ext).toBe(true);
    }
  });

  it('rechaza un ejecutable o una página HTML con cualquier extensión permitida', () => {
    for (const ext of attachmentAllowedExtensions) {
      expect(matches(ext, EXE), ext).toBe(false);
      expect(matches(ext, HTML), ext).toBe(false);
    }
  });

  it('rechaza contenido de otro tipo permitido y extensiones desconocidas', () => {
    expect(matches('pdf', valid.png![0]!)).toBe(false);
    expect(matches('dwg', valid.pdf![0]!)).toBe(false);
    expect(matches('doc', bytes('{\\rtf1\\ansi'))).toBe(false);
    expect(matches('dxf', bytes('hola', [0], 'mundo'))).toBe(false);
    expect(matches('dxf', bytes([0xef, 0xbb, 0xbf], 'hola'))).toBe(false);
    expect(matches('exe', EXE)).toBe(false);
  });

  it('no confunde propiedades del prototipo con extensiones', () => {
    for (const ext of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(detectContentType(ext, valid.pdf![0]!), ext).toBeNull();
    }
  });

  it('las imágenes son una familia: cualquier extensión de imagen acepta cualquier formato de imagen, con su tipo real', () => {
    const real: [Uint8Array, string][] = [
      [valid.jpg![0]!, 'image/jpeg'],
      [valid.png![0]!, 'image/png'],
      [valid.gif![0]!, 'image/gif'],
      [valid.webp![0]!, 'image/webp'],
      [valid.tiff![0]!, 'image/tiff'],
      [valid.tiff![1]!, 'image/tiff'],
    ];
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff']) {
      for (const [b, mime] of real) expect(detectContentType(ext, b), `${mime} como .${ext}`).toBe(mime);
      expect(detectContentType(ext, valid.pdf![0]!), ext).toBeNull();
    }
  });

  it('el tipo sale del contenido y la extensión, no de lo que declara el navegador', () => {
    expect(detectContentType('pdf', valid.pdf![0]!)).toBe('application/pdf');
    expect(detectContentType('doc', valid.doc![0]!)).toBe('application/msword');
    expect(detectContentType('xlsx', valid.xlsx![0]!)).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(detectContentType('dwg', valid.dwg![0]!)).toBe('image/vnd.dwg');
    expect(detectContentType('dxf', valid.dxf![3]!)).toBe('image/vnd.dxf');
  });
});
