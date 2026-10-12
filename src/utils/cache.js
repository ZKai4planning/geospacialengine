import { LRUCache } from 'lru-cache';
import { config } from '../config.js';

const cache = new LRUCache({ max: 5000, ttl: config.cacheTtlSeconds * 1000 });

/** Read-through cache. null/undefined results are not cached. */
export async function cached(key, fn, ttlSeconds) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  if (value !== undefined && value !== null) {
    cache.set(key, value, ttlSeconds ? { ttl: ttlSeconds * 1000 } : undefined);
  }
  return value;
}
