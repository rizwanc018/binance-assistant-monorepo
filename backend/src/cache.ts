type CacheEntry = {
  data: any;
  expiry: number;
};

const cache  = new Map<string, CacheEntry>();

export const getCache = (key: string): CacheEntry | null => {
    const entry = cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
    }

    return entry.data
}


export const setCache = (key: string, data: any, ttlMs: number) => {
  cache.set(key, {
    data,
    expiry: Date.now() + ttlMs,
  });
}