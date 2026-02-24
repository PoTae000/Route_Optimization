const CACHE_NAME = 'map-tiles-v1';
const MAX_CACHE = 8000;
const TILE_HOSTS = ['tile.openstreetmap.org', 'basemaps.cartocdn.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isTile = TILE_HOSTS.some(h => url.hostname.includes(h));
  if (!isTile) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache-first: ถ้ามีใน cache ส่งเลย
      const cached = await cache.match(e.request);
      if (cached) return cached;

      // ไม่มี → โหลดจาก network แล้ว cache
      try {
        const res = await fetch(e.request);
        if (res.ok) {
          cache.put(e.request, res.clone());
          // จำกัดขนาด cache
          trimCache(cache);
        }
        return res;
      } catch (err) {
        // Offline → ส่ง transparent pixel
        return new Response('', { status: 408 });
      }
    })
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_CACHE) {
    // ลบ tiles เก่าสุด
    const toDelete = keys.length - MAX_CACHE + 500;
    for (let i = 0; i < toDelete; i++) {
      cache.delete(keys[i]);
    }
  }
}
