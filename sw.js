/* Smokestack Symphony: funziona anche senza internet (modello: tools/pwa_build.py sostituisce 92b7f76822 e ["./", "./index.html", "./three.module.js", "./three.core.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png", "./favicon-32.png"]).
   La pagina si prende prima dalla rete (cosi' gli aggiornamenti arrivano subito); se la rete manca o e' troppo lenta,
   dalla copia salvata. Gli altri file (Three.js, icone) si prendono dalla copia salvata.
   Sullo stesso sito ci sono altri giochi (per esempio quello di matematica): si cancellano solo le copie di questo gioco. */
const VERSION = '92b7f76822';
const FILES = ["./", "./index.html", "./three.module.js", "./three.core.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png", "./favicon-32.png"];
const PRE = 'ss-' + new URL(self.registration.scope).pathname + '-';
const CACHE = PRE + VERSION;
const FONTS = 'ss-fonts';
const SLOW = 6000; // dopo 6 secondi senza risposta dalla rete si usa la copia salvata

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PRE) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// la pagina chiede di ricontrollare le copie (se un altro gioco dello stesso sito le ha cancellate, si rifanno)
self.addEventListener('message', e => {
  // solo la versione attiva: una versione vecchia, mentre arriva l'aggiornamento, ricreerebbe la propria copia gia' cancellata
  if (e.data === 'check' && self.serviceWorker && self.registration.active !== self.serviceWorker) return;
  if (e.data === 'check') e.waitUntil(caches.open(CACHE).then(async c => {
    if (self.serviceWorker) for (const k of await caches.keys()) if (k.startsWith(PRE) && k !== CACHE) await caches.delete(k);
    for (const f of FILES) if (!(await c.match(f))) { try { await c.add(new Request(f, { cache: 'reload' })); } catch (err) { /* senza rete: si riprova la prossima volta */ } }
  }));
});

function put(cacheName, req, res) {
  // la copia di questa versione la crea solo l'installazione: una versione vecchia non deve ricrearla dopo l'aggiornamento
  if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); (cacheName === CACHE ? caches.has(CACHE) : Promise.resolve(true)).then(h => { if (h) caches.open(cacheName).then(c => c.put(req, copy)); }); }
  return res;
}
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true, cacheName: CACHE }).then(r => r || caches.match(req, { ignoreSearch: true }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
    const isPage = req.mode === 'navigate' || /\.html?$|\/$/.test(url.pathname);
    if (isPage) {
      e.respondWith(new Promise(resolve => {
        let done = false;
        const fallback = () => fromCache(req).then(r => r || fromCache('./index.html')).then(r => r || fromCache('./'));
        const timer = setTimeout(() => fallback().then(r => { if (r && !done) { done = true; resolve(r); } }), SLOW);
        // no-cache: chiede sempre al sito se la pagina e' cambiata (GitHub Pages altrimenti la ripropone uguale per 10 minuti)
        fetch(req.url, { cache: 'no-cache' }).then(res => { put(CACHE, req, res); if (!done) { done = true; clearTimeout(timer); resolve(res); } })
          .catch(() => fallback().then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r || Response.error()); } }));
      }));
    } else {
      e.respondWith(fromCache(req).then(r => r || fetch(req).then(res => put(CACHE, req, res))));
    }
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // caratteri del titolo: copia salvata subito, aggiornata in sottofondo
    e.respondWith(caches.open(FONTS).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => put(FONTS, req, res)).catch(() => hit || Response.error());
      return hit || net;
    })));
  }
});
