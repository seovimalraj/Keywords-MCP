// ─────────────────────────────────────────────
//  utils/cache.ts  –  In-memory cache wrapper
// ─────────────────────────────────────────────
import NodeCache from "node-cache";
import { config } from "../config";

const cache = new NodeCache({
  stdTTL: config.cache.stdTTL,
  checkperiod: config.cache.checkperiod,
  maxKeys: config.cache.maxKeys,
});

/**
 * Get a cached value. Returns undefined on cache miss.
 */
export function cacheGet<T>(key: string): T | undefined {
  return cache.get<T>(key);
}

/**
 * Store a value in cache with optional custom TTL (seconds).
 */
export function cacheSet<T>(key: string, value: T, ttl?: number): void {
  if (ttl !== undefined) {
    cache.set(key, value, ttl);
  } else {
    cache.set(key, value);
  }
}

/**
 * Build a deterministic cache key from an object of parameters.
 */
export function buildCacheKey(prefix: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join("&");
  return `${prefix}::${sorted}`;
}

/**
 * Returns current cache stats.
 */
export function cacheStats() {
  return cache.getStats();
}
