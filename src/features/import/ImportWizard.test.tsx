import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ImportSource, ImportStatusFull } from '@/shared/types';
import { MappingStep, defaultOptions, mappingErrors } from './MappingStep';
import { ResultStep } from './ResultStep';
import { summaryText } from './ReviewStep';
import { UploadStep } from './UploadStep';

const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

const source: ImportSource = {
  importId: '11111111-1111-4111-8111-111111111111',
  fileType: 'csv',
  headerRow: 1,
  delimiter: ';',
  headers: ['Permiso', 'Calle', 'Comentario'],
  totalRows: 3,
  preview: [{ rowNumber: 2, values: { Permiso: '12', Calle: 'Riquelme 111', Comentario: 'x' } }],
  suggestedMapping: { Permiso: null, Calle: null, Comentario: 'comments' },
  layer: {
    id: 7,
    name: 'Obras Menores',
    hasRole: true,
    fields: [
      { key: 'n_permiso', label: 'N° Permiso', type: 'number', required: true, options: {} },
      { key: 'direccion', label: 'Dirección', type: 'string', required: false, options: {} },
    ],
    uniqueKeys: ['n_permiso'],
    addressFieldKey: 'direccion',
  },
};

describe('MappingStep (§10.2 paso 2)', () => {
  it('muestra los errores del mapeo y deshabilita Analizar hasta que esté completo', () => {
    wrap(<MappingStep source={source} onBack={() => {}} onAnalyzing={() => {}} />);
    expect(screen.getByText('Mapea el Rol SII o el campo de dirección (Dirección).')).toBeInTheDocument();
    expect(screen.getByText('Campo requerido "N° Permiso" sin mapear.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analizar' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    // los encabezados se listan con su selector
    expect(screen.getByLabelText('Permiso')).toBeInTheDocument();
    expect(screen.getByLabelText('Calle')).toBeInTheDocument();
  });

  it('con el mapeo completo habilita Analizar y envía las opciones por defecto', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ importId: source.importId, status: 'ANALYZING' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const o = {
      ...defaultOptions(source),
      mapping: { Permiso: 'n_permiso', Calle: 'direccion', Comentario: 'comments' },
    };
    expect(mappingErrors(source, o).general).toEqual([]);
    wrap(<MappingStep source={source} initial={o} onBack={() => {}} onAnalyzing={() => {}} />);
    const button = screen.getByRole('button', { name: 'Analizar' });
    expect(button).toBeEnabled();
    expect(
      screen.getByLabelText('Las celdas vacías no borran datos existentes', { exact: false }),
    ).toBeChecked();
    expect(screen.getByLabelText('Preguntarme uno por uno', { exact: false })).toBeChecked();
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/imports/${source.importId}/analyze`);
    expect(JSON.parse(String(init.body))).toMatchObject({
      columnMapping: { Permiso: 'n_permiso', Calle: 'direccion', Comentario: 'comments' },
      duplicateStrategy: 'ask',
      keepExistingOnEmpty: true,
      geocode: true,
      fullReplace: false,
      rowFrom: null,
      rowTo: null,
    });
  });

  it('mappingErrors detecta destinos repetidos y lat/lon incompletos', () => {
    const o = {
      ...defaultOptions(source),
      mapping: { Permiso: 'n_permiso', Calle: 'n_permiso', Comentario: 'lat' },
    };
    const errs = mappingErrors(source, o);
    expect(errs.byHeader.Permiso).toMatch(/N° Permiso.*2 columnas/);
    expect(errs.general).toContain('Latitud y longitud van juntas: mapea las dos columnas o ninguna.');
  });
});

const status: ImportStatusFull = {
  id: source.importId,
  layerId: 7,
  layerName: 'Obras Menores',
  userId: 'u',
  userEmail: 'u@t',
  fileName: 'permisos.xlsx',
  fileType: 'xlsx',
  sheetName: 'Datos',
  headerRow: 3,
  delimiter: null,
  columnMapping: { Permiso: 'n_permiso' },
  rowFrom: null,
  rowTo: null,
  duplicateStrategy: 'ask',
  keepExistingOnEmpty: true,
  fullReplace: true,
  geocode: true,
  status: 'COMPLETED',
  progress: { phase: 'completed' },
  totalRows: 150,
  createdCount: 120,
  updatedCount: 30,
  skippedCount: 5,
  failedCount: 3,
  deletedCount: 2,
  errorMessage: null,
  createdAt: '2026-10-05T10:00:00.000Z',
  analyzedAt: '2026-10-05T10:01:00.000Z',
  committedAt: '2026-10-05T10:05:00.000Z',
  revertedAt: null,
  revertedBy: null,
  expiresAt: null,
  counts: { valid: 100, warning: 20, duplicate: 30, error: 3, excluded: 5, unresolvedDuplicates: 0 },
  codeCounts: {},
  removals: { total: 4, toDelete: 2, notDeletable: 1 },
  nextNumber: { fieldKey: 'n_permiso', label: 'N° Permiso', next: 6124 },
  layer: source.layer,
  pendingGeocode: 0,
  headers: ['Permiso'],
  resolutions: { skip: 0, update: 30, create: 0 },
};

describe('ResultStep (§10.2 paso 4)', () => {
  it('muestra los conteos, el próximo correlativo y la descarga de errores, y avisa a la capa', () => {
    const onCompleted = vi.fn();
    wrap(<ResultStep status={status} onClose={() => {}} onCompleted={onCompleted} />);
    expect(screen.getByRole('heading', { name: 'Importación completada' })).toBeInTheDocument();
    for (const [label, value] of [
      ['Creados', '120'],
      ['Actualizados', '30'],
      ['Omitidos', '5'],
      ['Fallidos', '3'],
      ['Eliminados', '2'],
    ] as const) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(value);
    }
    expect(screen.getByText('6.124')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Descargar filas con errores \(3\)/ });
    expect(link).toHaveAttribute('href', `/api/imports/${source.importId}/errors`);
    expect(onCompleted).toHaveBeenCalledWith(7);
  });

  it('el resumen de la revisión explica la consecuencia concreta', () => {
    expect(summaryText(status)).toBe(
      'Se crearán 120 registros, se actualizarán 30, se omitirán 5, fallarán 3, se eliminarán 2.',
    );
  });
});

describe('UploadStep con archivos de Google Earth', () => {
  const kmz: ImportSource = {
    ...source,
    fileType: 'kmz',
    headerRow: 0,
    delimiter: null,
    headers: ['Nombre', 'Latitud', 'Longitud'],
    totalRows: 2,
    skippedFeatures: 6,
    preview: [
      { rowNumber: 2, values: { Nombre: 'TPG1000', Latitud: '-33.5846', Longitud: '-70.6655' } },
      { rowNumber: 3, values: { Nombre: 'TPG1001', Latitud: '-33.5844', Longitud: '-70.6666' } },
    ],
  };

  it('acepta .kml y .kmz, no pide fila de encabezados y avisa los elementos que no son puntos', () => {
    const { container } = wrap(<UploadStep layerId={7} source={kmz} onSource={() => {}} onNext={() => {}} />);
    expect(container.querySelector('input[type="file"]')).toHaveAttribute('accept', '.csv,.xlsx,.kml,.kmz');
    expect(screen.queryByLabelText('Fila con los nombres de las columnas')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Separador de columnas')).not.toBeInTheDocument();
    expect(screen.getByText(/Cada punto del archivo de Google Earth es una fila/)).toBeInTheDocument();
    expect(
      screen.getByText(
        '6 elementos del archivo no son puntos (por ejemplo, áreas o líneas) y no se importarán.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/El archivo tiene 2 puntos\./)).toBeInTheDocument();
    expect(screen.getByText('TPG1000')).toBeInTheDocument();
  });
});
