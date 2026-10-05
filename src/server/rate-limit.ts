import { RateLimitedError } from './errors';

/**
 * Límite de tasa en memoria por clave (ventana deslizante simple). Suficiente para una instancia (§3.5 punto 38).
 * Better Auth trae el suyo para `/api/auth/*`.
 */
type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();

export type RateLimitRule = { windowSec: number; max: number };

export const rateLimits = {
  importUpload: { windowSec: 60, max: 10 } satisfies RateLimitRule,
  geocode: { windowSec: 60, max: 30 } satisfies RateLimitRule,
  admin: { windowSec: 60, max: 60 } satisfies RateLimitRule,
  attachmentUpload: { windowSec: 60, max: 30 } satisfies RateLimitRule,
};

export function rateLimit(key: string, rule: RateLimitRule, message?: string): void {
  const now = Date.now();
  const windowMs = rule.windowSec * 1000;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= rule.max) {
    buckets.set(key, bucket);
    throw new RateLimitedError(message);
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);

  // limpieza ocasional para no crecer sin límite
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (b.timestamps.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
}

/** Solo para tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
