const CACHE_NAME = 'map-tiles-v2';
const MAX_CACHE = 10000;
const TILE_HOSTS = ['tile.openstreetmap.org', 'basemaps.cartocdn.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  // ลบ cache เก่า
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isTile = TILE_HOSTS.some(h => url.hostname.includes(h));
  if (!isTile) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(e.request);

      // Stale-while-revalidate: ส่ง cache ทันที + อัพเดตเบื้องหลัง
      if (cached) {
        // โหลดใหม่เบื้องหลัง (ไม่ block)
        fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res);
        }).catch(() => {});
        return cached;
      }

      // ไม่มี cache → โหลดจาก network
      try {
        const res = await fetch(e.request);
        if (res.ok) {
          cache.put(e.request, res.clone());
          trimCache(cache);
        }
        return res;
      } catch (err) {
        // Offline → ส่ง transparent 1x1 PNG
        return new Response(
          Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualzQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)),
          { status: 200, headers: { 'Content-Type': 'image/png' } }
        );
      }
    })
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_CACHE) {
    const toDelete = keys.length - MAX_CACHE + 500;
    for (let i = 0; i < toDelete; i++) {
      cache.delete(keys[i]);
    }
  }
}
