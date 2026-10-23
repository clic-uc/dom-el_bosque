import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';
import { decode, Parser } from 'saxen';
import { ValidationError } from '../errors';
import type { ParsedTable, TableRow } from './table';

/**
 * Lectura de KML / KMZ (Google Earth) para la importación. Cada marcador (`Placemark`) con un único punto es una
 * fila, numerada por su orden en el archivo (1 = primer marcador, igual que la lista de Google Earth):
 *  - Nombre, Descripción (sin HTML) y Carpeta (solo si los puntos están en más de una carpeta)
 *  - una columna por cada dato extendido (`ExtendedData`: `Data` o `SimpleData`), p. ej. un rol
 *  - Latitud y Longitud, tal como vienen en el archivo
 * Las áreas, líneas y marcadores sin ubicación no se importan: solo se cuentan (`skippedFeatures`).
 */

/** Tope del KML descomprimido de un KMZ (el comprimido ya está acotado por `MAX_IMPORT_FILE_MB`). */
const MAX_KML_BYTES = 50 * 1024 * 1024;

const OTHER_GEOMETRIES = new Set([
  'LineString',
  'LinearRing',
  'Polygon',
  'Model',
  'gx:Track',
  'gx:MultiTrack',
]);

/** Columna con el nombre de cada marcador (el mapeo sugerido la usa). */
export const KML_NAME_HEADER = 'Nombre';
const DESCRIPTION = 'Descripción';
const FOLDER = 'Carpeta';
const LAT = 'Latitud';
const LON = 'Longitud';

type Placemark = {
  name: string;
  description: string;
  folders: string[];
  data: Map<string, string>;
  points: string[];
  otherGeometry: boolean;
};

/** El KML principal de un KMZ: `doc.kml` o, si no está, el primero en la raíz del ZIP (como Google Earth). */
export function extractKmz(buffer: Buffer): Buffer {
  let tooBig = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        if (!f.name.toLowerCase().endsWith('.kml')) return false;
        if (f.originalSize > MAX_KML_BYTES) tooBig = true;
        return f.originalSize <= MAX_KML_BYTES;
      },
    });
  } catch {
    throw new ValidationError(
      'No pudimos abrir el archivo .kmz. Vuelve a guardarlo desde Google Earth e intenta de nuevo.',
    );
  }
  const names = Object.keys(files);
  const main =
    names.find((n) => n.toLowerCase() === 'doc.kml') ?? names.find((n) => !n.includes('/')) ?? names[0];
  if (!main) {
    throw new ValidationError(
      tooBig
        ? 'El archivo .kmz tiene demasiados datos. Divídelo en partes más pequeñas en Google Earth.'
        : 'El archivo .kmz no tiene puntos de Google Earth adentro. Revisa que sea el archivo correcto.',
    );
  }
  return Buffer.from(files[main]!);
}

/** UTF-8 salvo que la declaración XML indique otra codificación (p. ej. ISO-8859-1). */
export function decodeKmlBuffer(buffer: Buffer): string {
  const head = buffer.subarray(0, 200).toString('latin1');
  const declared = /^(?:ï»¿)?<\?xml[^>]*encoding=["']([\w.-]+)["']/i.exec(head)?.[1];
  const text =
    declared && !/^utf-?8$/i.test(declared) && iconv.encodingExists(declared)
      ? iconv.decode(buffer, declared)
      : buffer.toString('utf8');
  return text.replace(/^﻿/, '');
}

/** Descripción de Google Earth (a menudo HTML) como texto plano, con un salto de línea por párrafo o fila. */
export function descriptionText(value: string): string {
  if (!value.includes('<')) return value.trim();
  const text = value
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    // `decode` solo conoce las entidades de XML; `&nbsp;` es la de HTML más común en los globos.
    .replace(/&nbsp;/gi, ' ');
  return decode(text)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n\s*/g, '\n')
    .trim();
}

/** Nombre local del elemento: `kml:Placemark` → `Placemark` (los de Google, `gx:`, conservan su prefijo). */
const localName = (name: string) => (name.startsWith('kml:') ? name.slice(4) : name);

function readPlacemarks(xml: string): Placemark[] {
  const placemarks: Placemark[] = [];
  const stack: string[] = [];
  const folders: string[] = [];
  let pm: Placemark | null = null;
  let dataName: string | null = null;
  // Texto del elemento que se está capturando y su profundidad en `stack`.
  let buf: string | null = null;
  let bufDepth = 0;

  const captures = (name: string, parent: string | undefined) =>
    (name === 'name' && (parent === 'Placemark' || parent === 'Folder')) ||
    (name === 'description' && parent === 'Placemark') ||
    (name === 'coordinates' && parent === 'Point') ||
    (name === 'value' && parent === 'Data') ||
    name === 'SimpleData';

  const parser = new Parser();
  parser.on('openTag', (raw, attrs, _decode, selfClosing) => {
    const name = localName(raw);
    const parent = stack.at(-1);
    if (stack.length === 0 && name !== 'kml') {
      throw new ValidationError(
        'El archivo no es un KML de Google Earth. Revisa que sea el archivo correcto.',
      );
    }
    stack.push(name);
    if (name === 'Folder') folders.push('');
    else if (name === 'Placemark') {
      pm = {
        name: '',
        description: '',
        folders: folders.filter(Boolean),
        data: new Map(),
        points: [],
        otherGeometry: false,
      };
    } else if (pm && OTHER_GEOMETRIES.has(name)) pm.otherGeometry = true;
    else if (pm && (name === 'Data' || name === 'SimpleData')) {
      const a = attrs();
      dataName = (a && a.name?.trim()) || null;
    }
    if (!selfClosing && buf === null && captures(name, parent)) {
      buf = '';
      bufDepth = stack.length;
    }
  });
  parser.on('text', (value, decodeEntities) => {
    if (buf !== null) buf += decodeEntities(value);
  });
  parser.on('cdata', (value) => {
    if (buf !== null) buf += value;
  });
  parser.on('closeTag', (raw) => {
    const name = localName(raw);
    const depth = stack.length;
    stack.pop();
    const parent = stack.at(-1);
    if (buf !== null && depth === bufDepth) {
      const text = buf;
      buf = null;
      if (name === 'name' && parent === 'Folder') folders[folders.length - 1] = text.trim();
      else if (pm) {
        if (name === 'name') pm.name = text.trim();
        else if (name === 'description') pm.description = descriptionText(text);
        else if (name === 'coordinates') pm.points.push(text);
        else if (dataName && !pm.data.has(dataName)) pm.data.set(dataName, text.trim());
      }
    }
    if (name === 'Placemark' && pm) {
      placemarks.push(pm);
      pm = null;
    } else if (name === 'Folder') folders.pop();
  });

  let failed = false;
  parser.on('error', () => {
    failed = true;
  });
  parser.parse(xml);
  if (failed || stack.length > 0) {
    throw new ValidationError(
      'No pudimos leer el archivo KML: parece dañado o incompleto. Vuelve a guardarlo desde Google Earth e intenta de nuevo.',
    );
  }
  return placemarks;
}

/** Primer par `lon,lat[,alt]` de un `<coordinates>`. */
function pointLatLon(coordinates: string): { lat: string; lon: string } {
  const [lon = '', lat = ''] = (coordinates.trim().split(/\s+/)[0] ?? '').split(',');
  return { lat: lat.trim(), lon: lon.trim() };
}

/**
 * Carpeta de cada punto sin las carpetas que comparten todos (p. ej. la carpeta raíz del archivo):
 * "Capa / Sector norte" y "Capa / Sector sur" → "Sector norte" y "Sector sur". Nunca deja una carpeta vacía.
 */
function folderLabels(paths: string[][]): string[] {
  const shortest = Math.min(...paths.map((p) => p.length));
  let common = 0;
  while (common < shortest - 1 && paths.every((p) => p[common] === paths[0]![common])) common++;
  return paths.map((p) => p.slice(common).join(' / '));
}

/** Agrega `name` a `used` sin repetir (sin distinguir mayúsculas): "Nombre" → "Nombre (2)". */
function uniqueHeader(name: string, used: Set<string>): string {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function parseKml(buffer: Buffer): ParsedTable & { headerRow: number } {
  const placemarks = readPlacemarks(decodeKmlBuffer(buffer));
  if (placemarks.length === 0) {
    throw new ValidationError(
      'El archivo no tiene marcadores de Google Earth. Revisa que sea el archivo correcto.',
    );
  }

  const points = placemarks
    .map((p, i) => ({ p, rowNumber: i + 1 }))
    .filter(({ p }) => p.points.length === 1 && !p.otherGeometry);
  const skippedFeatures = placemarks.length - points.length;
  if (points.length === 0) {
    throw new ValidationError(
      'El archivo solo tiene áreas o líneas, y la plataforma importa puntos. Marca cada lugar con un punto en Google Earth e intenta de nuevo.',
    );
  }

  const used = new Set<string>();
  const headers: string[] = [uniqueHeader(KML_NAME_HEADER, used)];
  const descHeader = points.some(({ p }) => p.description) ? uniqueHeader(DESCRIPTION, used) : null;
  if (descHeader) headers.push(descHeader);
  const folders = folderLabels(points.map(({ p }) => p.folders));
  const folderHeader = new Set(folders).size > 1 ? uniqueHeader(FOLDER, used) : null;
  if (folderHeader) headers.push(folderHeader);
  // Latitud y Longitud se reservan antes que los datos extendidos: un dato que se llame igual queda "(2)".
  const latHeader = uniqueHeader(LAT, used);
  const lonHeader = uniqueHeader(LON, used);
  // Una columna por dato extendido, en el orden en que aparece por primera vez.
  const dataHeaders = new Map<string, string>();
  for (const { p } of points) {
    for (const key of p.data.keys()) {
      if (!dataHeaders.has(key)) dataHeaders.set(key, uniqueHeader(key, used));
    }
  }
  headers.push(...dataHeaders.values(), latHeader, lonHeader);

  const rows: TableRow[] = points.map(({ p, rowNumber }, i) => {
    const values: Record<string, string> = { [headers[0]!]: p.name };
    if (descHeader) values[descHeader] = p.description;
    if (folderHeader) values[folderHeader] = folders[i]!;
    for (const [key, header] of dataHeaders) values[header] = p.data.get(key) ?? '';
    const { lat, lon } = pointLatLon(p.points[0]!);
    values[latHeader] = lat;
    values[lonHeader] = lon;
    return { rowNumber, values };
  });

  // Sin fila de encabezados: las columnas las arma la plataforma (0 = "antes del primer marcador").
  return { headers, rows, totalRows: rows.length, headerRow: 0, skippedFeatures };
}

export function parseKmz(buffer: Buffer): ParsedTable & { headerRow: number } {
  return parseKml(extractKmz(buffer));
}
