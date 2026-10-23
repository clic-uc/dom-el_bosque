import { strToU8, zipSync } from 'fflate';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import { kmlBuffer, kmzBuffer, placemark } from './__tests__/fixtures';
import { descriptionText, extractKmz, parseKml, parseKmz } from './parse-kml';

describe('parseKml (Google Earth)', () => {
  it('lee nombre, descripción y coordenadas de cada punto, como en una exportación de Google Earth Pro', () => {
    const t = parseKml(
      kmlBuffer([
        placemark('Platabanda Llanquiray', '-70.68954607618591,-33.55266281529237,0'),
        placemark('Platabanda Nueva Imperial', '-70.6623381370449,-33.57749353632359,0', {
          description: '1191688-196-LP23',
        }),
      ]),
    );
    expect(t.headers).toEqual(['Nombre', 'Descripción', 'Latitud', 'Longitud']);
    expect(t.headerRow).toBe(0);
    expect(t.totalRows).toBe(2);
    expect(t.skippedFeatures).toBe(0);
    expect(t.rows).toEqual([
      {
        rowNumber: 1,
        values: {
          Nombre: 'Platabanda Llanquiray',
          Descripción: '',
          Latitud: '-33.55266281529237',
          Longitud: '-70.68954607618591',
        },
      },
      {
        rowNumber: 2,
        values: {
          Nombre: 'Platabanda Nueva Imperial',
          Descripción: '1191688-196-LP23',
          Latitud: '-33.57749353632359',
          Longitud: '-70.6623381370449',
        },
      },
    ]);
  });

  it('sin descripciones ni carpetas distintas, solo trae Nombre, Latitud y Longitud', () => {
    const t = parseKml(kmlBuffer([placemark('TPG1000', '-70.6655,-33.5846,0')]));
    expect(t.headers).toEqual(['Nombre', 'Latitud', 'Longitud']);
  });

  it('omite áreas, líneas y marcadores sin ubicación, y conserva la numeración del archivo', () => {
    const polygon = `<Placemark><name>SECTOR 1</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
      -70.66,-33.58,0 -70.67,-33.57,0 -70.66,-33.58,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
    const line =
      '<Placemark><name>Ruta</name><LineString><coordinates>-70.6,-33.5 -70.7,-33.6</coordinates></LineString></Placemark>';
    const t = parseKml(
      kmlBuffer([
        polygon,
        placemark('TPG1000', '-70.6655,-33.5846,0'),
        line,
        '<Placemark><name>Sin ubicación</name></Placemark>',
        placemark('TPG1001', '-70.6666,-33.5844'),
      ]),
    );
    expect(t.skippedFeatures).toBe(3);
    expect(t.rows.map((r) => [r.rowNumber, r.values.Nombre])).toEqual([
      [2, 'TPG1000'],
      [5, 'TPG1001'],
    ]);
  });

  it('agrega una columna por dato extendido (p. ej. el rol) y la carpeta cuando hay varias', () => {
    const t = parseKml(
      kmlBuffer([
        `<Folder><name>Sector norte</name>${placemark('A', '-70.66,-33.55', {
          extended:
            '<Data name="Rol"><value>04631-00030</value></Data><Data name="Latitud"><value>x</value></Data>',
        })}</Folder>`,
        `<Folder><name>Sector sur</name><Folder><name>2024</name>${placemark('B', '-70.67,-33.58', {
          extended:
            '<SchemaData schemaUrl="#s"><SimpleData name="Rol">04631-00031</SimpleData><SimpleData name="Tipo">Paradero</SimpleData></SchemaData>',
        })}</Folder></Folder>`,
      ]),
    );
    expect(t.headers).toEqual(['Nombre', 'Carpeta', 'Rol', 'Latitud (2)', 'Tipo', 'Latitud', 'Longitud']);
    expect(t.rows.map((r) => r.values)).toEqual([
      {
        Nombre: 'A',
        Carpeta: 'Sector norte',
        Rol: '04631-00030',
        'Latitud (2)': 'x',
        Tipo: '',
        Latitud: '-33.55',
        Longitud: '-70.66',
      },
      {
        Nombre: 'B',
        Carpeta: 'Sector sur / 2024',
        Rol: '04631-00031',
        'Latitud (2)': '',
        Tipo: 'Paradero',
        Latitud: '-33.58',
        Longitud: '-70.67',
      },
    ]);
  });

  it('acepta elementos con prefijo kml:, entidades XML y otra codificación declarada', () => {
    const xml =
      '<?xml version="1.0" encoding="ISO-8859-1"?><kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Document>' +
      '<kml:Placemark><kml:name>Calzada Peñón &amp; Ñuble</kml:name><kml:Point><kml:coordinates>-70.6,-33.5,0</kml:coordinates></kml:Point></kml:Placemark>' +
      '</kml:Document></kml:kml>';
    const t = parseKml(iconv.encode(xml, 'latin1'));
    expect(t.rows[0]!.values).toEqual({
      Nombre: 'Calzada Peñón & Ñuble',
      Latitud: '-33.5',
      Longitud: '-70.6',
    });
  });

  it('explica qué pasó cuando el archivo no sirve', () => {
    expect(() => parseKml(Buffer.from('<kml><Document><Placemark>'))).toThrow(/dañado o incompleto/);
    expect(() => parseKml(Buffer.from('no es xml'))).toThrow(ValidationError);
    expect(() => parseKml(Buffer.from('<html><body/></html>'))).toThrow(/no es un KML/);
    expect(() => parseKml(kmlBuffer([]))).toThrow(/no tiene marcadores/);
    expect(() =>
      parseKml(
        kmlBuffer([
          '<Placemark><name>Ruta</name><LineString><coordinates>-70.6,-33.5 -70.7,-33.6</coordinates></LineString></Placemark>',
        ]),
      ),
    ).toThrow(/solo tiene áreas o líneas/);
  });
});

describe('descriptionText', () => {
  it('quita el HTML de los globos de Google Earth y deja un salto de línea por fila', () => {
    expect(descriptionText('<img style="max-width:500px;" src="files/calzada_01.jpeg">')).toBe('');
    expect(
      descriptionText(
        '<table><tr><td>Rol</td><td>4631-30</td></tr><tr><td>Obra</td><td>Calzada&nbsp;sur</td></tr></table>',
      ),
    ).toBe('Rol 4631-30\nObra Calzada sur');
    expect(descriptionText('  Licitación 1191688-37-le24 ')).toBe('Licitación 1191688-37-le24');
  });
});

describe('parseKmz', () => {
  it('lee el doc.kml del KMZ e ignora las imágenes', () => {
    const t = parseKmz(kmzBuffer([placemark('Veredas Los Gomeros', '-70.6772,-33.5738,0')]));
    expect(t.rows[0]!.values.Nombre).toBe('Veredas Los Gomeros');
  });

  it('sin doc.kml usa el primer .kml de la raíz', () => {
    const zip = zipSync({
      'files/otro.kml': strToU8('<kml/>'),
      'Paraderos.kml': kmlBuffer([placemark('TPG1', '-70.6,-33.5')]),
    });
    expect(parseKml(extractKmz(Buffer.from(zip))).rows[0]!.values.Nombre).toBe('TPG1');
  });

  it('rechaza un KMZ dañado o sin KML adentro', () => {
    expect(() => parseKmz(Buffer.from('no es zip'))).toThrow(/No pudimos abrir el archivo .kmz/);
    const onlyImages = Buffer.from(zipSync({ 'files/a.png': new Uint8Array([1, 2, 3]) }));
    expect(() => parseKmz(onlyImages)).toThrow(/no tiene puntos de Google Earth/);
  });
});
