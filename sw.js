self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through network fetch: satisfies PWA installability without caching OAuth or Spotify API traffic
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isHtmlNav =
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  if (isHtmlNav) {
    const cacheMode = (url.searchParams.has('_') || url.searchParams.has('r')) ? 'no-store' : 'no-cache';
    event.respondWith(
      fetch(event.request, { cache: cacheMode }).catch(() => fetch(event.request))
    );
    return;
  }

  event.respondWith(fetch(event.request));
});

