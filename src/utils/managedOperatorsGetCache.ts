/**
 * Short-lived in-memory cache for idempotent GETs (subscriptions, CSVs, policy lists).
 * Scopes: `refreshEpoch` (subscription reload) and `policyListScope` (Installed Operators refresh)
 * avoid stale UI after explicit user actions.
 */

export const MANAGED_OPERATORS_GET_CACHE_TTL_MS = 45_000;

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();

function cloneForCache<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v)) as T;
  } catch {
    return v;
  }
}

/**
 * GET JSON with TTL. Skips cache when `bypassCache` or on fetcher throw (nothing stored).
 */
export async function cachedConsoleFetchJson<T>(
  cacheKey: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: { bypassCache?: boolean },
): Promise<T> {
  const now = Date.now();
  if (!options?.bypassCache) {
    const hit = store.get(cacheKey);
    if (hit && hit.expiresAt > now) {
      return cloneForCache(hit.value) as T;
    }
  }
  const value = await fetcher();
  store.set(cacheKey, { value: cloneForCache(value), expiresAt: now + ttlMs });
  return cloneForCache(value);
}

export function subscriptionGetCacheKey(refreshEpoch: number, url: string): string {
  return `sub|${refreshEpoch}|${url}`;
}

export function operatorPolicyListCacheKey(listScope: number, url: string): string {
  return `opl|${listScope}|${url}`;
}

export function operatorPolicyGetCacheKey(listScope: number, url: string): string {
  return `opg|${listScope}|${url}`;
}
