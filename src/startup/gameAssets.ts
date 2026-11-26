export interface GameAsset {
  path: string
  size: number
  revision: string
}

export interface AssetProgress {
  readyBytes: number
  totalBytes: number
  complete: boolean
}

const base = new URL(import.meta.env.BASE_URL, document.baseURI)
const revisionHeader = 'x-game-asset-revision'

/** Native image, media, module and worker requests can all reuse the same stored bytes. */
async function openGameCache(): Promise<Cache | undefined> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return
  const script = new URL('game-assets-sw.js', base).href
  async function connect() {
    const workers = navigator.serviceWorker
    const previous = await workers.getRegistration(base.href)
    const existing = previous?.installing ?? previous?.waiting ?? previous?.active
    if (existing && existing.scriptURL !== script) return
    await workers.register(script, { scope: base.href })
    await workers.ready
    if (workers.controller?.scriptURL !== script) {
      await new Promise<void>(resolve => {
        const finish = () => {
          window.clearTimeout(timer)
          workers.removeEventListener('controllerchange', finish)
          resolve()
        }
        const timer = window.setTimeout(finish, 2500)
        workers.addEventListener('controllerchange', finish)
      })
    }
    if (workers.controller?.scriptURL === script) return caches.open('mahjong-game-assets:' + base.href)
  }
  // Embedded browsers can restrict registration or storage. Their HTTP cache still works.
  let timer: number
  try {
    return await Promise.race([connect(), new Promise<undefined>(resolve => {
      timer = window.setTimeout(resolve, 4000)
    })])
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}

async function readAsset(asset: GameAsset, url: string, reload: boolean, report: (size: number) => void) {
  const controller = new AbortController()
  let timeout: number
  const resetTimeout = () => {
    window.clearTimeout(timeout)
    timeout = window.setTimeout(() => controller.abort(), 20_000)
  }
  resetTimeout()
  try {
    const response = await fetch(url, {
      headers: { 'x-game-preload': '1' },
      cache: reload ? 'reload' : globalThis.crypto?.subtle ? 'force-cache' : 'no-cache',
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error('HTTP ' + response.status)
    const reader = response.body.getReader()
    const parts: BlobPart[] = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetTimeout()
      received += value.byteLength
      if (received > asset.size) throw new Error('资源大小不符')
      parts.push(value as Uint8Array<ArrayBuffer>)
      report(received)
    }
    if (received !== asset.size) throw new Error('资源不完整')
    const blob = new Blob(parts, { type: response.headers.get('content-type') ?? '' })
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
      const revision = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
      if (revision !== asset.revision) throw new Error('资源版本不符')
    }
    return blob
  } finally {
    window.clearTimeout(timeout)
    controller.abort()
  }
}

export function createGamePreloader(assets: GameAsset[], report: (progress: AssetProgress) => void) {
  const totalBytes = assets.reduce((sum, asset) => sum + asset.size, 0)
  const ready = new Set<string>()
  let readyBytes = 0
  let cache: Cache | undefined
  let stored = new Map<string, Request>()
  let initialized = false
  const notify = () => report({ readyBytes, totalBytes, complete: ready.size === assets.length })

  return async function preload() {
    if (!initialized) {
      cache = await openGameCache()
      try {
        if (cache) stored = new Map((await cache.keys()).map(key => [key.url, key]))
      } catch { cache = undefined }
      const stale: Request[] = []
      for (const asset of assets) {
        const key = stored.get(new URL(asset.path, base).href)
        if (key?.headers.get(revisionHeader) === asset.revision) {
          ready.add(asset.path)
          readyBytes += asset.size
        } else if (key) stale.push(key)
      }
      // Drop changed bytes before downloading so even a subsequent quota failure
      // cannot leave the worker serving an older response for the same public URL.
      if (cache) await Promise.all(stale.map(key => cache.delete(key)))
      initialized = true
    }
    notify()
    const pending = assets.filter(asset => !ready.has(asset.path))
    let next = 0
    let failure: Error | undefined
    async function loadNext() {
      while (!failure && next < pending.length) {
        const asset = pending[next++]
        const url = new URL(asset.path, base).href
        let credited = 0
        const credit = (size: number) => {
          readyBytes += size - credited
          credited = size
          notify()
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const blob = await readAsset(asset, url, attempt > 0 || stored.has(url), credit)
            if (cache) {
              const key = new Request(url, { headers: { [revisionHeader]: asset.revision } })
              try { await cache.put(key, new Response(blob)) }
              catch { cache = undefined } // Storage quota or private mode; bytes are already fetched.
            }
            ready.add(asset.path)
            notify()
            break
          } catch (error) {
            credit(0)
            if (attempt === 1) {
              console.warn('游戏资源加载失败', asset.path, error)
              failure ??= new Error(asset.path)
            }
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, loadNext))
    if (failure) throw failure
    if (cache && stored.size) {
      const current = new Set(assets.map(asset => new URL(asset.path, base).href))
      const obsolete = [...stored.keys()].filter(url => !current.has(url))
      if (obsolete.length) navigator.serviceWorker.controller?.postMessage({ type: 'prune-game-assets', obsolete })
    }
  }
}
