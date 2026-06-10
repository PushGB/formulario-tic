const CACHE_NAME = 'tic-form-cache-v22';


const ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/index.js',
  '/js/vendor.js',
  '/js/xlsx.full.min.js',
  '/js/tailwind.min.js',
  '/js/lucide.min.js',
  '/js/html2pdf.bundle.min.js',
  '/img/logo-isp.svg',
  '/manifest.json'
];

// Instalar el Service Worker y almacenar los recursos en caché
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[Service Worker] Almacenando recursos estáticos en caché...');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activar el Service Worker y limpiar cachés antiguos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Eliminando caché antiguo:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estrategia de Carga: Stale-While-Revalidate
// Retorna el recurso desde la caché inmediatamente (si existe) y busca la versión fresca por red en segundo plano
self.addEventListener('fetch', e => {
  // Ignorar peticiones a Supabase (base de datos en la nube)
  if (e.request.url.includes('supabase.co')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      if (cachedResponse) {
        // Actualizar caché en segundo plano
        fetch(e.request).then(networkResponse => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, networkResponse));
          }
        }).catch(() => {
          // Ignorar fallos de red silenciosamente al estar offline
        });
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});

// Escuchar mensajes del cliente para forzar la actualización (skipWaiting)
self.addEventListener('message', e => {
  if (e.data && e.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
