'use client';

import { Layers } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/shared/states';
import { useCan } from '@/features/auth/actor-context';
import { ExportDialog } from '@/features/export/ExportDialog';
import { ImportWizard } from '@/features/import/ImportWizard';
import { LayerFormDialog } from '@/features/layers/LayerFormDialog';
import { CreateRecordDialog } from '@/features/records/CreateRecordDialog';
import { RecordsTable } from '@/features/records/RecordsTable';
import { RoleSheet } from '@/features/roles/RoleSheet';
import { cn } from '@/lib/utils';
import type { Department } from '@/shared/constants';
import type { GeocodeResult, LayerWithCount, RecordDetail, RecordListItem, RoleRecordItem } from '@/shared/types';
import { CoordinateUpdateDialog, type CoordinateChangeRequest } from './CoordinateUpdateDialog';
import { FiltersPanel } from './FiltersPanel';
import { DEFAULT_HEAT_SETTINGS, type HeatSettings } from './HeatmapPanel';
import { locationToParams, useInvalidateLayerData, useLayersQuery, type FeatureParams, type RecordsPageParams } from './hooks';
import { LayersSidebar } from './LayersSidebar';
import { MapController, MapControllerContext } from './map-controller';
import { MapView, type TempMarker } from './MapView';
import { PolygonSidePanel } from './PolygonSidePanel';
import { RecordSidePanel } from './RecordSidePanel';
import { Toolbar } from './Toolbar';
import { countActiveFilters, useMapUrlState } from './url-state';

type LayerDialogState = { mode: 'create'; department?: Department } | { mode: 'edit'; layer: LayerWithCount } | null;

/** Espacio de trabajo `/map` (§10.2): sidebar de capas, toolbar, mapa o tabla, paneles derechos y diálogos. */
export function MapWorkspace() {
  return (
    <Suspense fallback={<LoadingState rows={6} label="Preparando el mapa…" className="p-8" />}>
      <MapWorkspaceInner />
    </Suspense>
  );
}

function MapWorkspaceInner() {
  const url = useMapUrlState();
  const { state } = url;
  const can = useCan();
  const layersQuery = useLayersQuery();
  const layers = useMemo(() => layersQuery.data ?? [], [layersQuery.data]);
  const controller = useMemo(() => new MapController(), []);
  const invalidateLayer = useInvalidateLayerData();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [heatSettings, setHeatSettings] = useState<HeatSettings>(DEFAULT_HEAT_SETTINGS);
  const [layerDialog, setLayerDialog] = useState<LayerDialogState>(null);
  const [importLayerId, setImportLayerId] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pickActive, setPickActive] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lon: number; at: number } | null>(null);
  const [coordRequest, setCoordRequest] = useState<CoordinateChangeRequest | null>(null);
  const [tempMarker, setTempMarker] = useState<TempMarker | null>(null);

  const workingLayer = useMemo(() => layers.find((l) => l.id === state.layer) ?? null, [layers, state.layer]);

  // Sin capa en la URL (o con una que ya no existe): la primera con registros, o la primera.
  const initialized = useRef(false);
  useEffect(() => {
    if (!layersQuery.data) return;
    const exists = state.layer !== null && layersQuery.data.some((l) => l.id === state.layer);
    if (!exists) {
      const first = layersQuery.data.find((l) => l.recordCount > 0) ?? layersQuery.data[0];
      if (first) {
        url.set({ layer: first.id, overlays: state.overlays.filter((id) => id !== first.id) });
        controller.requestFitToLayer(first.id);
      }
      initialized.current = true;
      return;
    }
    if (!initialized.current) {
      initialized.current = true;
      // Enlace compartido sin registro/rol/polígono abierto: encuadrar la capa.
      if (state.record === null && state.role === null && state.polygon === null) controller.requestFitToLayer(state.layer!);
    }
  }, [layersQuery.data, state.layer, state.overlays, state.record, state.role, state.polygon, url, controller]);

  // El marcador temporal de "Ir a dirección" desaparece solo.
  useEffect(() => {
    if (!tempMarker) return;
    const t = setTimeout(() => setTempMarker(null), 20_000);
    return () => clearTimeout(t);
  }, [tempMarker]);

  const workingParams = useMemo<FeatureParams>(
    () => ({ search: state.q || undefined, filters: state.filters, ...locationToParams(state.loc, state.num) }),
    [state.q, state.filters, state.loc, state.num],
  );
  const tableParams = useMemo<RecordsPageParams>(
    () => ({ ...workingParams, page: state.page, pageSize: state.pageSize, sort: state.sort, dir: state.dir }),
    [workingParams, state.page, state.pageSize, state.sort, state.dir],
  );

  const selectWorking = useCallback(
    (layerId: number) => {
      url.setWorkingLayer(layerId);
      controller.requestFitToLayer(layerId);
    },
    [url, controller],
  );

  const flyToRecord = useCallback(
    (lat: number | null, lon: number | null) => {
      if (lat !== null && lon !== null) controller.flyTo({ lat, lon, zoom: 18 });
    },
    [controller],
  );

  const onSelectRecord = useCallback(
    (record: RecordListItem) => {
      flyToRecord(record.lat, record.lon);
      url.openRecord(record.id);
    },
    [flyToRecord, url],
  );

  const onGoToAddress = useCallback(
    (result: GeocodeResult) => {
      controller.flyTo({ lat: result.lat, lon: result.lon, zoom: 18 });
      setTempMarker({ lat: result.lat, lon: result.lon, label: result.label, at: Date.now() });
      if (state.view === 'table') url.setView('map');
    },
    [controller, state.view, url],
  );

  const onOpenRecordFromRole = useCallback(
    (record: RoleRecordItem, layerId: number) => {
      if (layerId !== state.layer && !state.overlays.includes(layerId)) url.toggleOverlay(layerId);
      flyToRecord(record.lat, record.lon);
      url.openRecord(record.id);
    },
    [state.layer, state.overlays, url, flyToRecord],
  );

  const onWorkInLayer = useCallback(
    (layerId: number) => {
      const current = state.record;
      url.setWorkingLayer(layerId);
      if (current !== null) url.openRecord(current);
    },
    [state.record, url],
  );

  const onCreated = useCallback(
    (record: RecordDetail) => {
      if (record.layerId !== state.layer && !state.overlays.includes(record.layerId)) url.toggleOverlay(record.layerId);
      flyToRecord(record.lat, record.lon);
      url.openRecord(record.id);
      if (state.view === 'table') url.setView('map');
    },
    [state.layer, state.overlays, state.view, url, flyToRecord],
  );

  const onPick = useCallback((lat: number, lon: number) => {
    setPicked({ lat, lon, at: Date.now() });
    setPickActive(false);
  }, []);
  const onCancelPick = useCallback(() => setPickActive(false), []);
  const onRequestPick = useCallback(() => {
    setPickActive(true);
    if (state.view === 'table') url.setView('map');
  }, [state.view, url]);

  const onRequestCoordinateChange = useCallback((req: CoordinateChangeRequest) => setCoordRequest(req), []);
  const onOpenSidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) setSidebarCollapsed(false);
    else setMobileSidebar(true);
  }, []);

  const onViewOnMap = useCallback(
    (record: RecordListItem) => {
      url.setView('map');
      flyToRecord(record.lat, record.lon);
      url.openRecord(record.id);
    },
    [url, flyToRecord],
  );

  const onOpenPolygon = useCallback((id: number) => url.openPolygon(id), [url]);
  const onOpenRecord = useCallback((id: number) => url.openRecord(id), [url]);

  const activeFilters = countActiveFilters(state);

  const rightPanel =
    state.record !== null ? (
      <RecordSidePanel
        key={state.record}
        recordId={state.record}
        workingLayerId={state.layer}
        onClose={url.closePanel}
        onOpenRole={url.openRole}
        onOpenRecord={onOpenRecord}
        onWorkInLayer={onWorkInLayer}
        onCenter={(lat, lon) => {
          if (state.view === 'table') url.setView('map');
          controller.flyTo({ lat, lon, zoom: 18 });
        }}
      />
    ) : state.role !== null ? (
      <RoleSheet
        key={state.role}
        roleId={state.role}
        workingLayerId={state.layer}
        onClose={url.closePanel}
        onOpenRole={url.openRole}
        onOpenRecord={onOpenRecordFromRole}
        onViewOnMap={(lat, lon) => {
          if (state.view === 'table') url.setView('map');
          controller.flyTo({ lat, lon, zoom: 18 });
        }}
      />
    ) : state.polygon !== null ? (
      <PolygonSidePanel
        key={state.polygon}
        polygonId={state.polygon}
        workingLayerId={state.layer}
        overlayLayerIds={state.overlays}
        onClose={url.closePanel}
        onOverlayLayer={url.toggleOverlay}
        onFit={(bbox) => {
          if (state.view === 'table') url.setView('map');
          controller.fitBounds(bbox);
        }}
      />
    ) : null;

  return (
    <MapControllerContext.Provider value={controller}>
      <div className="flex h-full w-full overflow-hidden bg-slate-50">
        <LayersSidebar
          collapsed={sidebarCollapsed}
          mobileOpen={mobileSidebar}
          onMobileOpenChange={setMobileSidebar}
          layers={layersQuery.data}
          isPending={layersQuery.isPending}
          error={layersQuery.error}
          onRetry={() => void layersQuery.refetch()}
          workingLayerId={state.layer}
          overlayLayerIds={state.overlays}
          polys={state.polys}
          heat={state.heat}
          heatLayers={state.heatLayers}
          heatSettings={heatSettings}
          onSelectWorking={(id) => {
            selectWorking(id);
            setMobileSidebar(false);
          }}
          onToggleOverlay={url.toggleOverlay}
          onTogglePoly={url.togglePolygonKind}
          onChangeHeat={url.setHeat}
          onChangeHeatSettings={setHeatSettings}
          onCreateLayer={(department) => setLayerDialog({ mode: 'create', department })}
          onEditLayer={(layer) => setLayerDialog({ mode: 'edit', layer })}
          onCollapse={() => setSidebarCollapsed(true)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Toolbar
            workingLayer={workingLayer}
            view={state.view}
            query={state.q}
            activeFilters={activeFilters}
            filtersOpen={filtersOpen}
            sidebarCollapsed={sidebarCollapsed}
            onOpenSidebar={onOpenSidebar}
            onToggleFilters={() => setFiltersOpen((o) => !o)}
            onQueryChange={url.setQuery}
            onSelectRecord={onSelectRecord}
            onSelectRole={url.openRole}
            onGoToAddress={onGoToAddress}
            onImport={() => workingLayer && setImportLayerId(workingLayer.id)}
            onExport={() => setExportOpen(true)}
            onCreate={() => setCreateOpen(true)}
            onViewChange={url.setView}
          />

          <div className="flex min-h-0 flex-1">
            <main className="relative min-w-0 flex-1" aria-label={state.view === 'table' ? 'Tabla de registros' : 'Mapa'}>
              <div className={cn('absolute inset-0', state.view === 'table' && 'hidden')}>
                <MapView
                  layers={layers}
                  workingLayerId={state.layer}
                  overlayLayerIds={state.overlays}
                  workingParams={workingParams}
                  selectedRecordId={state.record}
                  polygonKinds={state.polys}
                  heat={state.heat}
                  heatLayerIds={state.heatLayers}
                  heatSettings={heatSettings}
                  pickActive={pickActive}
                  tempMarker={tempMarker}
                  controller={controller}
                  onPick={onPick}
                  onCancelPick={onCancelPick}
                  onOpenRecord={onOpenRecord}
                  onOpenPolygon={onOpenPolygon}
                  onRequestCoordinateChange={onRequestCoordinateChange}
                />
              </div>
              {state.view === 'table' ? (
                workingLayer ? (
                  <RecordsTable
                    key={workingLayer.id}
                    layer={workingLayer}
                    params={tableParams}
                    onPageChange={url.setPage}
                    onPageSizeChange={url.setPageSize}
                    onSortChange={url.setSort}
                    onOpenRecord={onOpenRecord}
                    onOpenRole={url.openRole}
                    onViewOnMap={onViewOnMap}
                  />
                ) : (
                  <EmptyState icon={Layers} title="Elige una capa de trabajo" description="Marca una capa en el panel de la izquierda para ver sus registros en la tabla." className="h-full" />
                )
              ) : null}
            </main>

            {filtersOpen && workingLayer ? (
              <FiltersPanel
                key={workingLayer.id}
                layer={workingLayer}
                filters={state.filters}
                loc={state.loc}
                num={state.num}
                onApply={(filters, loc, num) => {
                  url.setFilters(filters, loc, num);
                  setFiltersOpen(false);
                }}
                onClose={() => setFiltersOpen(false)}
              />
            ) : null}
            {rightPanel}
          </div>
        </div>
      </div>

      {layerDialog ? (
        <LayerFormDialog
          open
          onOpenChange={(o) => !o && setLayerDialog(null)}
          mode={layerDialog.mode}
          layer={layerDialog.mode === 'edit' ? layerDialog.layer : undefined}
          defaultDepartment={layerDialog.mode === 'create' ? layerDialog.department : undefined}
          onSaved={(layer) => {
            if (layerDialog.mode === 'create') selectWorking(layer.id);
          }}
          onDeleted={(layerId) => {
            setLayerDialog(null);
            url.set({
              layer: state.layer === layerId ? null : state.layer,
              overlays: state.overlays.filter((id) => id !== layerId),
              record: state.layer === layerId ? null : state.record,
            });
          }}
          onImport={(layerId) => {
            setLayerDialog(null);
            setImportLayerId(layerId);
          }}
        />
      ) : null}

      {importLayerId !== null && can('imports.write') ? (
        <ImportWizard open onOpenChange={(o) => !o && setImportLayerId(null)} layerId={importLayerId} onCompleted={(layerId) => void invalidateLayer(layerId)} />
      ) : null}

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} layers={layers} defaultLayerId={state.layer} />

      {can('records.write') ? (
        <CreateRecordDialog
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o);
            if (!o) {
              setPickActive(false);
              setPicked(null);
            }
          }}
          layers={layers}
          defaultLayerId={state.layer}
          pickActive={pickActive}
          pickedLocation={picked}
          onRequestPick={onRequestPick}
          onOpenRecord={onOpenRecord}
          onCreated={onCreated}
        />
      ) : null}

      <CoordinateUpdateDialog
        request={coordRequest}
        onCancel={() => {
          controller.resetDragMarker();
          setCoordRequest(null);
        }}
        onDone={() => setCoordRequest(null)}
      />
    </MapControllerContext.Provider>
  );
}
