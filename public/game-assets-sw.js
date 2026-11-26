const scope = self.registration.scope
const cacheName = 'mahjong-game-assets:' + scope
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

// A tab on the previous release may still need its lazy game and worker chunks.
self.addEventListener('message', event => {
  if (event.data?.type !== 'prune-game-assets' || !Array.isArray(event.data.obsolete)) return
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window' })
    if (windows.some(client => client.id !== event.source?.id)) return
    const cache = await caches.open(cacheName)
    await Promise.all(event.data.obsolete.filter(url => typeof url === 'string' && url.startsWith(scope))
      .map(url => cache.delete(url)))
  })())
})

async function cachedResponse(request) {
  const cached = await caches.match(request.url, { cacheName })
  if (!cached) return fetch(request)
  const range = request.headers.get('range')
  if (!range) return cached
  // Native audio players can ask for a byte range even when the whole track is local.
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2])) return fetch(request)
  const blob = await cached.blob()
  const start = match[1] ? Number(match[1]) : Math.max(0, blob.size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), blob.size - 1) : blob.size - 1
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + blob.size } })
  return new Response(blob.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': blob.type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
    'Content-Range': 'bytes ' + start + '-' + end + '/' + blob.size,
  } })
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || request.mode === 'navigate' || request.headers.has('x-game-preload')) return
  if (!request.url.startsWith(scope)) return
  const path = request.url.slice(scope.length)
  if (!/^(assets|audio|avatars|effects|images|img|themes|tiles)\//.test(path) || path.includes('?')) return
  event.respondWith(cachedResponse(request).catch(() => fetch(request)))
})
