// Offline fallback ONLY. No authenticated HTML, API, notification or chat data is cached.
const CACHE='minsnooks-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))]));
});
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return; // never cache API or assets from a signed-in session
  event.respondWith(fetch(event.request).catch(async () => {
    const cached=await caches.open(CACHE);
    return (await cached.match('/offline.html')) ?? Response.error();
  }));
});
self.addEventListener('push', event => {
  let data={}; try { data=event.data?.json() ?? {}; } catch {}
  // Title/URL are server-generated generic strings; never show private DM content.
  const url=typeof data.href==='string' && /^\/[a-z0-9/]+$/.test(data.href) ? data.href : '/notifications';
  event.waitUntil(self.registration.showNotification(typeof data.title==='string' ? data.title : 'Minsnooks update', {body:'Open Minsnooks to see the update.',icon:'/icon.svg',data:{url},tag:'minsnooks-'+url}));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url=event.notification.data?.url ?? '/notifications';
  event.waitUntil(self.clients.openWindow(url));
});
