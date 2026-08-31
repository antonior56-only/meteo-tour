// Service Worker — Dashboard Meteo Ultimate Pro
//
// Scopo: far funzionare l'interfaccia (HTML/CSS/JS e la libreria Chart.js da CDN)
// anche offline o con rete instabile, così l'app si apre comunque invece di restare
// su una schermata bianca. I dati meteo NON vengono mai serviti dalla cache: l'app
// ha già una propria cache con scadenza (10 minuti) in sessionStorage per quello, e
// mostrare qui vecchi dati meteo come se fossero attuali sarebbe fuorviante per chi
// consulta le previsioni.
//
// Strategia: stale-while-revalidate per la shell dell'app e le risorse da CDN
// (risposta immediata dalla cache se presente, aggiornata in background quando
// la rete è disponibile); rete diretta, senza intervento del Service Worker, per
// tutte le chiamate alle API meteo/geocoding.

const CACHE_NAME = 'meteo-shell-v1';
const APP_SHELL = ['./', './manifest.json'];

// Host le cui risposte non devono mai passare dalla cache del Service Worker.
const NEVER_CACHE_HOSTS = [
    'api.open-meteo.com',
    'geocoding-api.open-meteo.com',
    'air-quality-api.open-meteo.com',
    'api.bigdatacloud.net'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
            .catch((err) => console.warn('[SW] Precache shell fallito (verrà comunque servito dalla rete):', err))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Solo richieste GET sono cacheabili; il resto (nessuna in questa app, ma per sicurezza)
    // passa sempre diretto alla rete.
    if (request.method !== 'GET') return;

    let url;
    try {
        url = new URL(request.url);
    } catch (e) {
        return; // URL non parsabile: lascia gestire al comportamento di default del browser
    }

    if (NEVER_CACHE_HOSTS.includes(url.hostname)) {
        return; // nessun event.respondWith: la richiesta prosegue normalmente verso la rete
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const networkFetch = fetch(request)
                .then((response) => {
                    if (response && response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                    }
                    return response;
                })
                .catch(() => cached); // offline e nessuna rete: usa la cache se disponibile

            return cached || networkFetch;
        })
    );
});
