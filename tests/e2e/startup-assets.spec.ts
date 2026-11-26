import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, preview } from 'vite'

test('a missing game asset holds the lobby, retry resumes the download', async ({ page }) => {
  let available = false
  let earlierAssetRequests = 0
  await page.route('**/audio/1m.mp3', route => {
    if (route.request().headers()['x-game-preload']) earlierAssetRequests++
    return route.continue()
  })
  await page.route('**/themes/lobby/v1/jade.png', route => available
    ? route.continue() : route.fulfill({ status: 503, body: '' }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const splash = page.locator('#game-startup')
  await expect(splash.getByRole('status')).toHaveText('资源加载未完成', { timeout: 25_000 })
  await expect(page.locator('main.game-app')).toHaveCount(0)
  await expect(splash.getByRole('progressbar')).not.toHaveJSProperty('value', 100)
  available = true
  await splash.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByRole('button', { name: /开始东风场/ })).toBeVisible({ timeout: 20_000 })
  expect(earlierAssetRequests).toBe(1)
})

test('a production release opens a match using its cache on a second visit', async ({ page }, info) => {
  test.setTimeout(90_000)
  const outDir = await mkdtemp(join(tmpdir(), 'mahjong-startup-'))
  const base = '/mahjong/'
  let denyGameAssets = false
  let allowedRepair = ''
  const repairs: string[] = []
  const misses: string[] = []
  let server: Awaited<ReturnType<typeof preview>>
  try {
    const nodeEnv = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      await build({ logLevel: 'error', build: { outDir } })
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = nodeEnv
    }
    server = await preview({
      base, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'observe-game-traffic',
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            if (denyGameAssets && /^\/mahjong\/(assets|tiles|themes|effects|audio|avatars|img|images)\//.test(req.url!)) {
              if (req.url === allowedRepair) {
                repairs.push(req.url)
                return next()
              }
              misses.push(req.url!)
              res.writeHead(503).end()
            } else next()
          })
        },
      }],
    })
    const address = server.httpServer.address() as { port: number }
    await page.route(/^https:\/\//, route => route.fulfill({ contentType: 'text/javascript', body: '' }))
    let release!: () => void
    const pause = new Promise<void>(resolve => { release = resolve })
    await page.route('**/img/llm/**', async route => {
      await pause
      await route.continue()
    })
    try {
      await page.goto('http://127.0.0.1:' + address.port + base, { waitUntil: 'domcontentloaded' })
      const bar = page.getByRole('progressbar')
      await expect.poll(() => bar.evaluate((p: HTMLProgressElement) => p.value)).toBeGreaterThan(0)
      await expect(page.locator('main.game-app')).toHaveCount(0)
      for (const [width, height] of [[1280, 800], [375, 667]]) {
        await page.setViewportSize({ width, height })
        await page.screenshot({ path: info.outputPath('startup-' + width + '.png') })
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      }
    } finally { release() }
    await page.setViewportSize({ width: 1280, height: 800 })
    const start = page.getByRole('button', { name: /开始东风场/ })
    await expect(start).toBeVisible({ timeout: 20_000 })
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain(base + 'game-assets-sw.js')
    denyGameAssets = true
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(start).toBeVisible({ timeout: 15_000 })
    const range = await page.evaluate(async () => {
      const response = await fetch('./audio/bg.ogg', { headers: { range: 'bytes=0-15' } })
      return [response.status, (await response.arrayBuffer()).byteLength]
    })
    expect(range).toEqual([206, 16])
    await start.click()
    await expect(page.locator('canvas.mahjong-scene')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.table-loading')).toBeHidden({ timeout: 20_000 })
    expect(misses).toEqual([])

    // An older copy at a stable URL must be replaced, without downloading its neighbours.
    allowedRepair = base + 'audio/1m.mp3'
    await page.evaluate(async path => {
      const cache = await caches.open('mahjong-game-assets:' + new URL('./', location.href).href)
      await cache.put(new Request(new URL(path, location.href), { headers: { 'x-game-asset-revision': 'older' } }),
        new Response('old audio'))
    }, allowedRepair)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(start).toBeVisible({ timeout: 15_000 })
    expect(repairs).toEqual([allowedRepair])
    expect(misses).toEqual([])
  } finally {
    await server?.close()
    await rm(outDir, { recursive: true, force: true })
  }
})
