const CACHE = 'still-shell-v9'
const ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/apple-touch-icon.png']
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())))
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())))
self.addEventListener('push', event => { let data = {}; try { data = event.data?.json?.() || {} } catch {} let url = '/'; try { const candidate = typeof data.url === 'string' ? new URL(data.url, self.location.origin) : new URL('/', self.location.origin); if (candidate.origin === self.location.origin) url = candidate.pathname + candidate.search + candidate.hash } catch {} event.waitUntil(self.registration.showNotification(data.title || 'Still', { body: data.body || 'A moment for your practice.', icon: data.icon || '/icons/icon-192.png', badge: data.badge || '/icons/icon-192.png', tag: typeof data.tag === 'string' ? data.tag : 'still-practice', renotify: false, data: { url } })) })
self.addEventListener('notificationclick', event => { event.notification.close(); let url = '/'; try { const candidate = new URL(event.notification.data?.url || '/', self.location.origin); if (candidate.origin === self.location.origin) url = candidate.pathname + candidate.search + candidate.hash } catch {} event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => { const existing = list.find(client => new URL(client.url).origin === self.location.origin); return existing ? existing.focus().then(() => existing.navigate(url)) : clients.openWindow(new URL(url, self.location.origin).href) })) })
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  const navigation = request.mode === 'navigate'
  const response = navigation
    ? fetch(request).then(async response => {
      try {
        const cache = await caches.open(CACHE)
        await cache.put('/', response.clone())
      } catch {}
      return response
    })
    : caches.match(request).then(cached => cached || fetch(request).then(async response => {
      if (url.pathname.startsWith('/_next/static/') || ASSETS.includes(url.pathname)) {
        try {
          const cache = await caches.open(CACHE)
          await cache.put(request, response.clone())
        } catch {}
      }
      return response
    }))
  event.respondWith(response.catch(() => caches.match(navigation ? '/' : request)))
})
