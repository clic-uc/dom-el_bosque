'use client';

import type { MapRef } from 'react-map-gl/maplibre';
import { createContext, useContext } from 'react';
import { COMUNA_BOUNDS, MAP_CENTER, MAP_INITIAL_ZOOM } from '@/shared/constants';

export type LngLatBBox = [west: number, south: number, east: number, north: number];

/**
 * API imperativa del mapa para el resto del espacio de trabajo (búsqueda, fichas, polígonos):
 * `flyTo`, `fitBounds`, `resetView`. Si el mapa aún no está listo, los comandos quedan en cola.
 * Evita pasar el `MapRef` por props y re-renderizar el mapa al abrir paneles (§3.4 punto 24).
 */
export class MapController {
  private map: MapRef | null = null;
  private queue: Array<(map: MapRef) => void> = [];
  private pendingFitLayerId: number | null = null;
  private handlers: { resetDragMarker?: () => void } = {};

  attach(map: MapRef | null): void {
    this.map = map;
    if (map) {
      const q = this.queue;
      this.queue = [];
      for (const cmd of q) cmd(map);
    }
  }

  private run(cmd: (map: MapRef) => void): void {
    if (this.map) cmd(this.map);
    else this.queue.push(cmd);
  }

  flyTo(opts: { lat: number; lon: number; zoom?: number }): void {
    this.run((map) => {
      const current = map.getZoom();
      map.flyTo({ center: [opts.lon, opts.lat], zoom: opts.zoom ?? Math.max(current, 17), duration: 900, essential: true });
    });
  }

  fitBounds(bbox: LngLatBBox, padding = 60): void {
    this.run((map) => {
      const [w, s, e, n] = bbox;
      if (w === e && s === n) {
        map.flyTo({ center: [w, s], zoom: 17, duration: 700 });
        return;
      }
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding, maxZoom: 17, duration: 700 },
      );
    });
  }

  /** Vuelve al centro de la comuna con el zoom inicial. */
  resetView(): void {
    this.run((map) => map.flyTo({ center: [MAP_CENTER.lon, MAP_CENTER.lat], zoom: MAP_INITIAL_ZOOM, duration: 700 }));
  }

  fitComuna(): void {
    this.fitBounds([COMUNA_BOUNDS.minLon, COMUNA_BOUNDS.minLat, COMUNA_BOUNDS.maxLon, COMUNA_BOUNDS.maxLat], 20);
  }

  /** Pide encuadrar los puntos de una capa cuando se carguen (lo consume la capa de trabajo en el mapa). */
  requestFitToLayer(layerId: number): void {
    this.pendingFitLayerId = layerId;
  }

  consumePendingFit(layerId: number): boolean {
    if (this.pendingFitLayerId !== layerId) return false;
    this.pendingFitLayerId = null;
    return true;
  }

  register(handlers: { resetDragMarker?: () => void }): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /** Devuelve el marcador arrastrado a su posición original (cancelación del cambio de coordenadas). */
  resetDragMarker(): void {
    this.handlers.resetDragMarker?.();
  }
}

export const MapControllerContext = createContext<MapController | null>(null);

export function useMapController(): MapController {
  const ctl = useContext(MapControllerContext);
  if (!ctl) throw new Error('useMapController debe usarse dentro de MapWorkspace');
  return ctl;
}

/** Caja envolvente de una colección de puntos `[lon, lat]`; `null` si no hay puntos. */
export function bboxOfPoints(coords: Iterable<[number, number]>): LngLatBBox | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  let any = false;
  for (const [lon, lat] of coords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    any = true;
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return any ? [w, s, e, n] : null;
}
