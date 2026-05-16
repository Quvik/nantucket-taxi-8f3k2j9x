const CACHE = 'ntaxi-v1';
const TILE_CACHE = 'ntaxi-tiles-v1';
const MAX_TILES = 600;

const CRITICAL = [
  '/nantucket-taxi-8f3k2j9x/',
  '/nantucket-taxi-8f3k2j9x/index.html',
  '/nantucket-taxi-8f3k2j9x/zones.kml',
  '/nantucket-taxi-8f3k2j9x/places.json',
  '/nantucket-taxi-8f3k2j9x/manifest.json',
];

const OPTIONAL = [
  '/nantucket-taxi-8f3k2j9x/ferries.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/togeojson/0.16.0/togeojson.min.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
];

const SKIP_HOSTS = [
  'gstatic.com', 'googleapis.com', 'firebaseio.com',
  'aisstream.io', 'airlabs.co', 'rapidapi.com',
  'allorigins.win', 'corsproxy.io', 'codetabs.com',
  'flaticon.com',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(CRITICAL).then(() =>
        Promise.allSettled(
          OPTIONAL.map(url =>
            fetch(url).then(r => r.ok ? cache.put(url, r) : null).catch(() => null)
          )
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Map tiles — cache with size limit
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(handleTile(e.request));
    return;
  }

  // External APIs — network only, don't interfere
  if (SKIP_HOSTS.some(h => url.hostname.includes(h))) return;

  // Everything else — cache first, fallback to network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Update cache in background
        fetch(e.request).then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r));
        }).catch(() => {});
        return cached;
      }
      return fetch(e.request).then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      }).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('/nantucket-taxi-8f3k2j9x/index.html');
        }
      });
    })
  );
});

async function handleTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const keys = await cache.keys();
      if (keys.length >= MAX_TILES) await cache.delete(keys[0]);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}
