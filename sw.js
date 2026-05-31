const CACHE      = 'ntaxi-v53';
const TILE_CACHE = 'ntaxi-tiles-v2';
const MAX_TILES  = 1000;

// Nantucket + surrounding waters bounding box
const BBOX = { north: 41.34, south: 41.19, west: -70.38, east: -69.84 };
// Pre-cache zoom levels: 11 (island overview) → 14 (street level)
const TILE_ZOOMS = [11, 12, 13, 14];

const CRITICAL = [
  '/nantucket-taxi-8f3k2j9x/',
  '/nantucket-taxi-8f3k2j9x/index.html',
  '/nantucket-taxi-8f3k2j9x/zones.kml',
  '/nantucket-taxi-8f3k2j9x/places.json',
  '/nantucket-taxi-8f3k2j9x/places.json?v=8',
  '/nantucket-taxi-8f3k2j9x/streets.json',
  '/nantucket-taxi-8f3k2j9x/streets.json?v=3',
  '/nantucket-taxi-8f3k2j9x/manifest.json',
];

const OPTIONAL = [
  '/nantucket-taxi-8f3k2j9x/ferries.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/togeojson/0.16.0/togeojson.min.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
  // Firebase SDK — must be cached for offline auth to work
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
];

const SKIP_HOSTS = [
  'googleapis.com','firebaseio.com',
  'aisstream.io','airlabs.co','rapidapi.com',
  'allorigins.win','corsproxy.io','codetabs.com',
  'flaticon.com',
  'nominatim.openstreetmap.org', // geocoding — always network, never cache
  'geocoding.geo.census.gov',   // US Census geocoding — always network
];

// ── Tile math ──────────────────────────────────────────────────
function lonToX(lon, z){ return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
function latToY(lat, z){
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1/Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
function nantucketTileUrls(){
  const urls = [];
  for(const z of TILE_ZOOMS){
    const x0=lonToX(BBOX.west,z), x1=lonToX(BBOX.east,z);
    const y0=latToY(BBOX.north,z), y1=latToY(BBOX.south,z);
    for(let x=x0;x<=x1;x++)
      for(let y=y0;y<=y1;y++)
        urls.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
  }
  return urls;
}

// ── Install: cache critical files, then tiles in background ───
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CRITICAL))
      .then(() => self.skipWaiting())
  );
  // Don't block install — cache optional + tiles in background
  caches.open(CACHE).then(cache =>
    Promise.allSettled(OPTIONAL.map(url =>
      fetch(url).then(r => r.ok ? cache.put(url, r) : null).catch(()=>null)
    ))
  );
  precacheTiles();
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

// ── Pre-cache all Nantucket tiles (polite 30ms gap between requests) ──
async function precacheTiles(){
  const cache = await caches.open(TILE_CACHE);
  const urls  = nantucketTileUrls();
  for(const url of urls){
    if(await cache.match(url)) continue;      // already cached
    try{
      const r = await fetch(url);
      if(r.ok) await cache.put(url, r);
    }catch{}
    await new Promise(res => setTimeout(res, 30)); // be polite to OSM
  }
}

// ── Fetch handler ──────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Map tiles — cache with size limit
  if(url.hostname === 'tile.openstreetmap.org'){
    e.respondWith(handleTile(e.request));
    return;
  }

  // External APIs — network only
  if(SKIP_HOSTS.some(h => url.hostname.includes(h))) return;

  // Static assets — cache first, update in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached){
        fetch(e.request).then(r => {
          if(r.ok) caches.open(CACHE).then(c => c.put(e.request, r));
        }).catch(()=>{});
        return cached;
      }
      return fetch(e.request).then(r => {
        if(r.ok){
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      }).catch(() => {
        if(e.request.mode === 'navigate')
          return caches.match('/nantucket-taxi-8f3k2j9x/index.html');
      });
    })
  );
});

async function handleTile(request){
  const cache  = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if(cached) return cached;
  try{
    const r = await fetch(request);
    if(r.ok){
      const keys = await cache.keys();
      if(keys.length >= MAX_TILES) await cache.delete(keys[0]);
      await cache.put(request, r.clone());
    }
    return r;
  }catch{
    return new Response('', {status:408});
  }
}
