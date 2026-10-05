'use client';

import type { Map as MaplibreMap } from 'maplibre-gl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getLucideIcon } from '@/components/shared/layer-icon';
import { DEFAULT_LAYER_ICON, DEFAULT_LAYER_ICON_COLOR } from '@/shared/constants';

/**
 * Imágenes de marcador para las style layers `symbol` (§10.2, §3.4 punto 28).
 * UNA imagen por (ícono, color), generada una sola vez: círculo blanco de 40 px, borde 2 px del color
 * e ícono lucide de 24 px centrado. La variante `-approx` (ubicación aproximada por dirección) lleva
 * el borde punteado. Se rasteriza a 2x y se registra con `map.addImage(name, data, { pixelRatio: 2 })`.
 */

const SIZE = 40;
const PIXEL_RATIO = 2;
const NAME_RE = /^marker-(.+)-([0-9a-f]{6})(-approx)?$/;

function normalizeColor(color: string | null | undefined): string {
  const hex = (color ?? DEFAULT_LAYER_ICON_COLOR).replace('#', '').toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? hex : DEFAULT_LAYER_ICON_COLOR.slice(1);
}

export function markerImageName(icon: string | null | undefined, color: string | null | undefined, approx = false): string {
  return `marker-${icon || DEFAULT_LAYER_ICON}-${normalizeColor(color)}${approx ? '-approx' : ''}`;
}

export function parseMarkerImageName(name: string): { icon: string; color: string; approx: boolean } | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  return { icon: m[1]!, color: `#${m[2]!}`, approx: m[3] === '-approx' };
}

/** SVG completo del marcador (exportado para tests y para depurar). */
export function buildMarkerSvg(icon: string, color: string, approx: boolean): string {
  const Icon = getLucideIcon(icon);
  const inner = renderToStaticMarkup(createElement(Icon, { size: 24, color, strokeWidth: 2, 'aria-hidden': true }));
  // El SVG del ícono se anida y se desplaza al centro del círculo.
  const positioned = inner.replace('<svg ', '<svg x="8" y="8" ');
  const dash = approx ? ' stroke-dasharray="4 3"' : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<circle cx="20" cy="20" r="18" fill="#ffffff" stroke="${color}" stroke-width="2"${dash}/>` +
    positioned +
    `</svg>`
  );
}

const imageCache = new Map<string, Promise<ImageData>>();

function rasterize(svg: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const px = SIZE * PIXEL_RATIO;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No se pudo crear el lienzo del marcador'));
        return;
      }
      ctx.drawImage(img, 0, 0, px, px);
      resolve(ctx.getImageData(0, 0, px, px));
    };
    img.onerror = () => reject(new Error('No se pudo dibujar el marcador'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Rasteriza (una vez por nombre) la imagen del marcador. */
export function getMarkerImage(icon: string, color: string, approx: boolean): Promise<ImageData> {
  const name = markerImageName(icon, color, approx);
  let p = imageCache.get(name);
  if (!p) {
    p = rasterize(buildMarkerSvg(icon, color, approx)).catch((err) => {
      imageCache.delete(name);
      throw err;
    });
    imageCache.set(name, p);
  }
  return p;
}

async function addIfMissing(map: MaplibreMap, name: string): Promise<void> {
  const parsed = parseMarkerImageName(name);
  if (!parsed) return;
  if (map.hasImage(name)) return;
  const data = await getMarkerImage(parsed.icon, parsed.color, parsed.approx);
  // Puede haberse registrado mientras rasterizábamos (dos capas con el mismo ícono y color).
  if (!map.hasImage(name)) map.addImage(name, data, { pixelRatio: PIXEL_RATIO });
}

/** Registra la imagen normal y la aproximada de una capa, si aún no existen. */
export async function ensureMarkerImages(map: MaplibreMap, icon: string | null | undefined, color: string | null | undefined): Promise<void> {
  const base = icon || DEFAULT_LAYER_ICON;
  const hex = `#${normalizeColor(color)}`;
  try {
    await Promise.all([addIfMissing(map, markerImageName(base, hex, false)), addIfMissing(map, markerImageName(base, hex, true))]);
  } catch {
    // Respaldo: ícono por defecto, para que el punto siempre se vea.
    await Promise.all([
      addIfMissing(map, markerImageName(DEFAULT_LAYER_ICON, DEFAULT_LAYER_ICON_COLOR, false)),
      addIfMissing(map, markerImageName(DEFAULT_LAYER_ICON, DEFAULT_LAYER_ICON_COLOR, true)),
    ]).catch(() => undefined);
  }
}

/**
 * Respaldo para imágenes que el estilo pide antes de que la capa las haya registrado
 * (`setMissingStyleImageResolver` espera la promesa; `styleimagemissing` cubre versiones sin resolver).
 */
export function installMarkerImageFallback(map: MaplibreMap): () => void {
  const resolver = (id: string) => addIfMissing(map, id).catch(() => undefined);
  if (typeof map.setMissingStyleImageResolver === 'function') {
    map.setMissingStyleImageResolver(resolver);
  }
  const onMissing = (e: { id: string }) => {
    void resolver(e.id);
  };
  map.on('styleimagemissing', onMissing);
  return () => {
    map.off('styleimagemissing', onMissing);
    if (typeof map.setMissingStyleImageResolver === 'function') map.setMissingStyleImageResolver(null);
  };
}
