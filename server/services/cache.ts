class SimpleCache {
  private cache = new Map<string, { value: any; expires: number }>();

  set(key: string, value: any, ttlMs: number = 300000) { // 5 min default
    const expires = Date.now() + ttlMs;
    this.cache.set(key, { value, expires });
  }

  get(key: string): any | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return undefined;
    }
    return item.value;
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

export const cache = new SimpleCache();