import { createGamePreloader, type AssetProgress } from './startup/gameAssets'

const splash = document.querySelector<HTMLElement>('#game-startup')!
const bar = splash.querySelector('progress')!
const status = splash.querySelector<HTMLElement>('[role=status]')!
const percent = splash.querySelector<HTMLElement>('#startup-percent')!
const detail = splash.querySelector<HTMLElement>('#startup-detail')!
const retry = splash.querySelector('button')!
const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1)

let frame = 0
let lastSample: { time: number, bytes: number } | undefined
let rate = ''
function showProgress(progress: AssetProgress) {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const now = performance.now()
    if (!lastSample || progress.readyBytes < lastSample.bytes) {
      lastSample = { time: now, bytes: progress.readyBytes }
      rate = ''
    } else if (now - lastSample.time >= 600) {
      const bytesPerSecond = (progress.readyBytes - lastSample.bytes) * 1000 / (now - lastSample.time)
      rate = bytesPerSecond > 0 ? ' · ' + mb(bytesPerSecond) + ' MB/s' : ''
      lastSample = { time: now, bytes: progress.readyBytes }
    }
    bar.value = progress.complete ? 100 : Math.min(99, Math.floor(progress.readyBytes / progress.totalBytes * 100))
    percent.textContent = bar.value + '%'
    detail.textContent = '已准备 ' + mb(progress.readyBytes) + ' / ' + mb(progress.totalBytes) + ' MB' + (progress.complete ? '' : rate)
  })
}

let preload: () => Promise<void>
async function start() {
  retry.hidden = true
  status.textContent = '正在加载游戏资源'
  try {
    if (!preload) {
      const assets = JSON.parse(document.getElementById('game-asset-manifest')!.textContent!)
      if (!assets.length) throw new Error('资源清单为空')
      preload = createGamePreloader(assets, showProgress)
    }
    await preload()
  } catch (error) {
    cancelAnimationFrame(frame)
    status.textContent = '资源加载未完成'
    detail.textContent = '请检查网络后重试 · ' + (error instanceof Error ? error.message : '')
    retry.hidden = false
    retry.onclick = preload ? start : () => location.reload()
    return
  }
  status.textContent = '正在进入游戏大厅'
  try {
    const { mountGame } = await import('./mountGame')
    mountGame()
    cancelAnimationFrame(frame)
    splash.remove()
  } catch (error) {
    console.error('游戏启动失败', error)
    status.textContent = '游戏启动失败'
    detail.textContent = '请刷新页面以获取最新版本'
    retry.hidden = false
    retry.onclick = () => location.reload()
  }
}
void start()
