'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useQueries } from '@tanstack/react-query';
import { setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';

// Turbopack no resuelve la URL del worker desde `import.meta.url`: lo servimos desde `public/`
// (lo copia `scripts/copy-maplibre-worker.mjs` en predev/prebuild) y cumple la CSP `worker-src 'self'`.
if (typeof window !== 'undefined') setWorkerUrl('/maplibre-gl-worker.mjs');
import { Move, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  Source,
  useMap,
  type MapLayerMouseEvent,
  type MapRef,
  type MarkerDragEvent,
} from 'react-map-gl/maplibre';
import { Button } from '@/components/ui/button';
import { useCan } from '@/features/auth/actor-context';
import { formatFieldValue } from '@/lib/format';
import {
  COMUNA_BOUNDS,
  MAP_CENTER,
  MAP_INITIAL_ZOOM,
  MAP_MAX_BOUNDS_MARGIN,
  polygonStyles,
  type PolygonKind,
} from '@/shared/constants';
import type { LayerWithCount, RecordFeatureCollection } from '@/shared/types';
import type { CoordinateChangeRequest } from './CoordinateUpdateDialog';
import type { HeatSettings } from './HeatmapPanel';
import {
  featuresQueryOptions,
  useLayerFeatures,
  usePolygons,
  useRecordDetail,
  type FeatureParams,
} from './hooks';
import { bboxOfPoints, type MapController } from './map-controller';
import { ensureMarkerImages, installMarkerImageFallback, markerImageName } from './marker-images';
import type { HeatMode } from './url-state';

export type TempMarker = { lat: number; lon: number; label: string; at: number };

export type MapViewProps = {
  layers: LayerWithCount[];
  workingLayerId: number | null;
  overlayLayerIds: number[];
  /** Búsqueda y filtros de la capa de trabajo (las superpuestas se dibujan completas). */
  workingParams: FeatureParams;
  selectedRecordId: number | null;
  polygonKinds: PolygonKind[];
  heat: HeatMode | null;
  heatLayerIds: number[];
  heatSettings: HeatSettings;
  pickActive: boolean;
  tempMarker: TempMarker | null;
  controller: MapController;
  onPick: (lat: number, lon: number) => void;
  onCancelPick: () => void;
  onOpenRecord: (recordId: number) => void;
  onOpenPolygon: (polygonId: number) => void;
  onRequestCoordinateChange: (req: CoordinateChangeRequest) => void;
};

const EMPTY_FC: RecordFeatureCollection = { type: 'FeatureCollection', features: [] };

/** Respaldo si `NEXT_PUBLIC_MAP_STYLE_URL` no está definido: teselas raster de OSM. */
const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const MAP_STYLE: string | StyleSpecification = process.env.NEXT_PUBLIC_MAP_STYLE_URL || OSM_RASTER_STYLE;
const MAX_BOUNDS: [number, number, number, number] = [
  COMUNA_BOUNDS.minLon - MAP_MAX_BOUNDS_MARGIN,
  COMUNA_BOUNDS.minLat - MAP_MAX_BOUNDS_MARGIN,
  COMUNA_BOUNDS.maxLon + MAP_MAX_BOUNDS_MARGIN,
  COMUNA_BOUNDS.maxLat + MAP_MAX_BOUNDS_MARGIN,
];
const TEXT_FONT = ['Noto Sans Bold'];

/** Orden de dibujo (de abajo hacia arriba): polígonos → calor → superpuestas → trabajo → selección. */
const ANCHORS = {
  polygons: 'anchor-polygons',
  heat: 'anchor-heat',
  overlays: 'anchor-overlays',
  working: 'anchor-working',
} as const;

function Anchors() {
  return (
    <>
      <Layer id={ANCHORS.polygons} type="background" paint={{ 'background-opacity': 0 }} />
      <Layer id={ANCHORS.heat} type="background" paint={{ 'background-opacity': 0 }} />
      <Layer id={ANCHORS.overlays} type="background" paint={{ 'background-opacity': 0 }} />
      <Layer id={ANCHORS.working} type="background" paint={{ 'background-opacity': 0 }} />
    </>
  );
}

function PolygonLayers({ kind }: { kind: PolygonKind }) {
  const { data } = usePolygons(kind);
  const style = polygonStyles[kind];
  const sourceId = `polygons-${kind}`;
  if (!data) return null;
  return (
    <Source id={sourceId} type="geojson" data={data}>
      <Layer
        id={`poly-fill-${kind}`}
        type="fill"
        beforeId={ANCHORS.polygons}
        paint={{ 'fill-color': style.line, 'fill-opacity': style.fillOpacity }}
      />
      <Layer
        id={`poly-line-${kind}`}
        type="line"
        beforeId={ANCHORS.polygons}
        paint={{ 'line-color': style.line, 'line-width': style.width, 'line-opacity': style.opacity }}
      />
    </Source>
  );
}

function RecordsLayer({
  layer,
  params,
  isWorking,
  pointsVisible,
  controller,
}: {
  layer: LayerWithCount;
  params: FeatureParams;
  isWorking: boolean;
  pointsVisible: boolean;
  controller: MapController;
}) {
  const { current: map } = useMap();
  const { data } = useLayerFeatures(layer.id, params);
  const sourceId = `records-${layer.id}`;
  const imgName = markerImageName(layer.icon, layer.iconColor);
  const imgApprox = markerImageName(layer.icon, layer.iconColor, true);
  const beforeId = isWorking ? ANCHORS.working : ANCHORS.overlays;

  useEffect(() => {
    if (!map) return;
    void ensureMarkerImages(map.getMap(), layer.icon, layer.iconColor);
  }, [map, layer.icon, layer.iconColor]);

  // Encuadre al cambiar la capa de trabajo (§10.2): a sus puntos, o al centro de la comuna si no tiene.
  useEffect(() => {
    if (!isWorking || !data || !controller.consumePendingFit(layer.id)) return;
    const bbox = bboxOfPoints(data.features.map((f) => f.geometry.coordinates as [number, number]));
    if (bbox) controller.fitBounds(bbox);
    else controller.resetView();
  }, [data, isWorking, layer.id, controller]);

  const visibility = pointsVisible ? 'visible' : 'none';
  return (
    <Source
      id={sourceId}
      type="geojson"
      data={data ?? EMPTY_FC}
      cluster
      clusterMaxZoom={16}
      clusterRadius={50}
    >
      <Layer
        id={`clusters-${layer.id}`}
        type="circle"
        beforeId={beforeId}
        filter={['has', 'point_count']}
        layout={{ visibility }}
        paint={{
          'circle-color': layer.iconColor,
          'circle-radius': ['step', ['get', 'point_count'], 18, 11, 22, 101, 26],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        }}
      />
      <Layer
        id={`cluster-count-${layer.id}`}
        type="symbol"
        beforeId={beforeId}
        filter={['has', 'point_count']}
        layout={{
          visibility,
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': TEXT_FONT,
          'text-size': 13,
          'text-allow-overlap': true,
        }}
        paint={{ 'text-color': '#ffffff' }}
      />
      <Layer
        id={`points-${layer.id}`}
        type="symbol"
        beforeId={beforeId}
        filter={['!', ['has', 'point_count']]}
        layout={{
          visibility,
          'icon-image': ['case', ['==', ['get', 'coordsSource'], 'geocoded'], imgApprox, imgName],
          'icon-size': 1,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        }}
      />
    </Source>
  );
}

function percentile95(values: number[]): number {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
  return sorted[idx] || 1;
}

function HeatmapLayer({
  layers,
  mode,
  settings,
}: {
  layers: LayerWithCount[];
  mode: HeatMode;
  settings: HeatSettings;
}) {
  const weighted = mode === 'value';
  // `combine` está memoizado por TanStack: la colección unida solo se recalcula cuando cambian los datos.
  const { data, wMax } = useQueries({
    queries: layers.map((l) => featuresQueryOptions(l.id, { weight: weighted })),
    combine: (results) => {
      const features = results.flatMap((r) => r.data?.features ?? []);
      const values = weighted
        ? features.map((f) => (typeof f.properties.w === 'number' ? f.properties.w : 0)).filter((w) => w > 0)
        : [];
      return {
        data: { type: 'FeatureCollection', features } as RecordFeatureCollection,
        wMax: percentile95(values),
      };
    },
  });

  return (
    <Source id="heatmap" type="geojson" data={data}>
      <Layer
        id="heatmap"
        type="heatmap"
        beforeId={ANCHORS.heat}
        paint={{
          'heatmap-weight': weighted
            ? ['interpolate', ['linear'], ['coalesce', ['get', 'w'], 0], 0, 0, wMax, 1]
            : 1,
          'heatmap-intensity': settings.intensity,
          'heatmap-radius': settings.radius,
          'heatmap-opacity': 0.8,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(33,102,172,0)',
            0.2,
            '#67a9cf',
            0.4,
            '#a1dab4',
            0.6,
            '#fecc5c',
            0.8,
            '#fd8d3c',
            1,
            '#e31a1c',
          ],
        }}
      />
    </Source>
  );
}

function SelectedRecord({
  recordId,
  canEdit,
  controller,
  onRequestCoordinateChange,
}: {
  recordId: number;
  canEdit: boolean;
  controller: MapController;
  onRequestCoordinateChange: (req: CoordinateChangeRequest) => void;
}) {
  const { data } = useRecordDetail(recordId);
  // El arrastre guarda desde qué posición partió: si el registro cambia de coordenadas (guardado), deja de aplicar.
  const [drag, setDrag] = useState<{ base: string; lat: number; lon: number } | null>(null);

  useEffect(() => {
    controller.register({ resetDragMarker: () => setDrag(null) });
    return () => controller.register({ resetDragMarker: undefined });
  }, [controller]);

  if (!data || data.lat === null || data.lon === null) return null;
  const base = `${data.id}:${data.lat}:${data.lon}`;
  const pos =
    drag && drag.base === base ? { lat: drag.lat, lon: drag.lon } : { lat: data.lat, lon: data.lon };
  const fc: RecordFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: data.id,
        geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
        properties: { id: data.id, roleId: data.roleId, coordsSource: data.coordsSource ?? 'own' },
      },
    ],
  };

  function onDragEnd(e: MarkerDragEvent) {
    const to = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    setDrag({ base, ...to });
    onRequestCoordinateChange({
      recordId: data!.id,
      layerId: data!.layerId,
      roleId: data!.roleId,
      from: { lat: data!.lat!, lon: data!.lon! },
      to,
    });
  }

  return (
    <>
      <Source id="selected" type="geojson" data={fc}>
        <Layer
          id="points-selected"
          type="circle"
          paint={{
            'circle-radius': 26,
            'circle-color': '#73308a',
            'circle-opacity': 0.18,
            'circle-stroke-color': '#73308a',
            'circle-stroke-width': 3,
          }}
        />
      </Source>
      {canEdit ? (
        <Marker longitude={pos.lon} latitude={pos.lat} draggable onDragEnd={onDragEnd} anchor="center">
          <div
            role="img"
            aria-label="Arrastra para mover la ubicación del registro"
            title="Arrastra para mover la ubicación"
            className="flex size-14 cursor-grab items-center justify-center rounded-full border-2 border-dashed border-primary/70 bg-transparent active:cursor-grabbing"
          >
            <Move className="size-4 text-primary opacity-70" aria-hidden />
          </div>
        </Marker>
      ) : null}
    </>
  );
}

type Hover = { lon: number; lat: number; key: string; title: string; lines: string[] };

function MapViewInner(props: MapViewProps) {
  const {
    layers,
    workingLayerId,
    overlayLayerIds,
    workingParams,
    selectedRecordId,
    polygonKinds,
    heat,
    heatLayerIds,
    heatSettings,
    pickActive,
    tempMarker,
    controller,
    onPick,
    onCancelPick,
    onOpenRecord,
    onOpenPolygon,
    onRequestCoordinateChange,
  } = props;
  const can = useCan();
  const canEdit = can('records.write');
  const mapRef = useRef<MapRef | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const byId = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  const workingLayer = workingLayerId !== null ? byId.get(workingLayerId) : undefined;
  const overlays = useMemo(
    () =>
      overlayLayerIds
        .map((id) => byId.get(id))
        .filter((l): l is LayerWithCount => !!l && l.id !== workingLayerId),
    [overlayLayerIds, byId, workingLayerId],
  );
  const heatLayers = useMemo(() => {
    if (!heat) return [];
    const visible = [workingLayer, ...overlays].filter((l): l is LayerWithCount => !!l);
    const eligible = visible.filter((l) => heat === 'density' || !!l.heatmapFieldKey);
    return heatLayerIds.length ? eligible.filter((l) => heatLayerIds.includes(l.id)) : eligible;
  }, [heat, heatLayerIds, workingLayer, overlays]);
  const pointsVisible = !heat || heatSettings.showPoints;

  const interactiveLayerIds = useMemo(() => {
    const ids: string[] = [];
    const visibleLayers = [workingLayer, ...overlays].filter((l): l is LayerWithCount => !!l);
    if (pointsVisible) for (const l of visibleLayers) ids.push(`clusters-${l.id}`, `points-${l.id}`);
    for (const k of polygonKinds) ids.push(`poly-fill-${k}`);
    return ids;
  }, [workingLayer, overlays, polygonKinds, pointsVisible]);

  const setRef = useCallback(
    (ref: MapRef | null) => {
      mapRef.current = ref;
      controller.attach(ref);
    },
    [controller],
  );

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    installMarkerImageFallback(map);
  }, []);

  const describePoint = useCallback(
    (layerId: number, props: Record<string, unknown>): { title: string; lines: string[] } => {
      const layer = byId.get(layerId);
      const lines: string[] = [];
      if (layer?.hasRole) lines.push(`Rol: ${(props.roleId as string | null) ?? 'Sin rol'}`);
      const first = layer?.fields[0];
      if (first) {
        const text = formatFieldValue(props[first.key], first.type);
        if (text) lines.push(`${first.label}: ${text}`);
      }
      if (props.coordsSource === 'geocoded') lines.push('Ubicación aproximada por dirección');
      return { title: layer?.name ?? 'Registro', lines };
    },
    [byId],
  );

  const onMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) {
        setHover((h) => (h ? null : h));
        return;
      }
      const layerId = f.layer.id;
      if (layerId.startsWith('clusters-')) {
        setHover((h) => (h ? null : h));
        return;
      }
      if (layerId.startsWith('points-')) {
        const lid = Number(layerId.slice('points-'.length));
        const key = `r${f.properties.id}`;
        const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        setHover((h) => (h?.key === key ? h : { key, lon, lat, ...describePoint(lid, f.properties) }));
        return;
      }
      if (layerId.startsWith('poly-fill-')) {
        const key = `p${f.properties.id}`;
        setHover((h) =>
          h?.key === key
            ? h
            : {
                key,
                lon: e.lngLat.lng,
                lat: e.lngLat.lat,
                title: (f.properties.name as string | null) || 'Polígono sin nombre',
                lines: [],
              },
        );
      }
    },
    [describePoint],
  );

  const onMouseLeave = useCallback(() => setHover(null), []);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (pickActive) {
        onPick(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const features = e.features ?? [];
      const cluster = features.find((f) => f.layer.id.startsWith('clusters-'));
      if (cluster) {
        const map = mapRef.current?.getMap();
        const source = map?.getSource(cluster.layer.id.replace('clusters-', 'records-')) as
          GeoJSONSource | undefined;
        const clusterId = cluster.properties.cluster_id as number;
        const center = (cluster.geometry as GeoJSON.Point).coordinates as [number, number];
        if (source && map) {
          void source
            .getClusterExpansionZoom(clusterId)
            .then((zoom) => map.easeTo({ center, zoom: Math.min(zoom, 19), duration: 500 }));
        }
        return;
      }
      const point = features.find((f) => f.layer.id.startsWith('points-'));
      if (point) {
        onOpenRecord(Number(point.properties.id));
        return;
      }
      const poly = features.find((f) => f.layer.id.startsWith('poly-fill-'));
      if (poly) onOpenPolygon(Number(poly.properties.id));
    },
    [pickActive, onPick, onOpenRecord, onOpenPolygon],
  );

  const cursor = pickActive ? 'crosshair' : hover ? 'pointer' : 'grab';

  return (
    <div className="relative h-full w-full" data-testid="map-view">
      <MapGL
        ref={setRef}
        mapStyle={MAP_STYLE}
        initialViewState={{ longitude: MAP_CENTER.lon, latitude: MAP_CENTER.lat, zoom: MAP_INITIAL_ZOOM }}
        maxBounds={MAX_BOUNDS}
        minZoom={10}
        maxZoom={20}
        interactiveLayerIds={interactiveLayerIds}
        cursor={cursor}
        onLoad={onLoad}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ width: '100%', height: '100%' }}
        reuseMaps
      >
        <NavigationControl position="bottom-left" showCompass={false} />
        <ScaleControl position="bottom-right" />
        <Anchors />
        {polygonKinds.map((k) => (
          <PolygonLayers key={k} kind={k} />
        ))}
        {heat && heatLayers.length ? (
          <HeatmapLayer layers={heatLayers} mode={heat} settings={heatSettings} />
        ) : null}
        {overlays.map((l) => (
          <RecordsLayer
            key={l.id}
            layer={l}
            params={EMPTY_PARAMS}
            isWorking={false}
            pointsVisible={pointsVisible}
            controller={controller}
          />
        ))}
        {workingLayer ? (
          <RecordsLayer
            key={workingLayer.id}
            layer={workingLayer}
            params={workingParams}
            isWorking
            pointsVisible={pointsVisible}
            controller={controller}
          />
        ) : null}
        {selectedRecordId !== null ? (
          <SelectedRecord
            recordId={selectedRecordId}
            canEdit={canEdit && !pickActive}
            controller={controller}
            onRequestCoordinateChange={onRequestCoordinateChange}
          />
        ) : null}
        {hover && !pickActive ? (
          <Popup
            longitude={hover.lon}
            latitude={hover.lat}
            closeButton={false}
            closeOnClick={false}
            offset={18}
            anchor="bottom"
            className="pointer-events-none"
            maxWidth="280px"
          >
            <div className="space-y-0.5 text-sm">
              <p className="font-semibold">{hover.title}</p>
              {hover.lines.map((l) => (
                <p key={l} className="text-muted-foreground">
                  {l}
                </p>
              ))}
            </div>
          </Popup>
        ) : null}
        {tempMarker ? (
          <>
            <Marker longitude={tempMarker.lon} latitude={tempMarker.lat} anchor="bottom">
              <div className="flex flex-col items-center" aria-hidden>
                <div className="size-5 rounded-full border-4 border-white bg-primary shadow-md" />
                <div className="-mt-1 h-3 w-0.5 bg-primary" />
              </div>
            </Marker>
            <Popup
              longitude={tempMarker.lon}
              latitude={tempMarker.lat}
              closeButton={false}
              closeOnClick={false}
              offset={30}
              anchor="bottom"
              maxWidth="280px"
            >
              <p className="text-sm font-medium">{tempMarker.label}</p>
            </Popup>
          </>
        ) : null}
      </MapGL>

      {pickActive ? (
        <div
          role="status"
          aria-live="assertive"
          className="absolute top-3 left-1/2 z-(--z-index-map-controls) flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background px-4 py-2 shadow-lg"
        >
          <p className="text-base font-medium">Haz clic en el mapa para seleccionar la ubicación</p>
          <Button variant="outline" size="lg" className="h-10" onClick={onCancelPick}>
            <X aria-hidden /> Cancelar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const EMPTY_PARAMS: FeatureParams = {};

/** Mapa MapLibre (§10.2). Memoizado: los paneles y diálogos del espacio de trabajo no lo re-renderizan. */
export const MapView = memo(MapViewInner);
