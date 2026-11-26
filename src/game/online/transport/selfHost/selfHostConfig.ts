// 自托管 P2P 传输层配置：从 URL 查询参数 / Vite 环境变量读取信令与 STUN/TURN 地址。
//
// 触发方式（任选其一，查询参数优先）：
//   - 信令地址：?selfHost=ws://127.0.0.1:8787  或  VITE_SELF_HOST_SIGNALING
//   - TURN 中继：?turn=turn:user:pass@host:3478  或  VITE_TURN_SERVER
//   - STUN 服务器：?stun=stun:host:3478  或  VITE_STUN_SERVER（不传用公共 STUN）
//   - 固定 peerId（重连测试用）：?selfHostPeer=p-xxx
//
// 未配置信令地址时返回 null，调用方回退到 mock / 真实 SDK。

export interface SelfHostConfig {
  signalingUrl: string
  iceServers: RTCIceServer[]
  peerId?: string
  /** 强制只走 TURN relay（iceTransportPolicy='relay'）。 */
  forceRelay?: boolean
  /** 加入后自动模拟一次 P2P → Relay 切换的延迟（ms）；不传则不模拟。 */
  relayAfterMs?: number
  /** 模拟 Relay 的持续时间（ms）；0 表示保持 Relay。 */
  relayDurationMs?: number
}

function query(name: string): string | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = new URLSearchParams(window.location.search).get(name)
    return raw && raw.trim() ? raw.trim() : null
  } catch {
    return null
  }
}

function env(name: string): string | null {
  try {
    const value = (import.meta.env as Record<string, string | undefined>)[name]
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function parseNumber(raw: string | null): number | undefined {
  if (raw == null || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function queryNumber(name: string): number | undefined {
  return parseNumber(query(name))
}

function flag(name: string, envName: string): boolean {
  const q = query(name)
  if (q != null) return q === '1' || q === 'true'
  const e = env(envName)
  return e === '1' || e === 'true'
}

/** 解析 turn:user:pass@host:port / turns:... 为 RTCIceServer。 */
function parseTurnServer(url: string): RTCIceServer | null {
  const match = url.match(/^(turns?):(?:(?:([^:@]+)(?::([^@]*))?)@)?(.+)$/)
  if (!match) return null
  const scheme = match[1]
  const user = match[2]
  const pass = match[3]
  const hostPort = match[4]
  const server: RTCIceServer = { urls: `${scheme}:${hostPort}` }
  if (user != null) server.username = decodeURIComponent(user)
  if (pass != null) server.credential = decodeURIComponent(pass)
  return server
}

function parseStunServer(url: string): RTCIceServer | null {
  return /^stuns?:.+/.test(url) ? { urls: url } : null
}

const SAVED_SIGNALING_KEY = 'chizhou_signaling_url'

export function readSavedSignalingUrl(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(SAVED_SIGNALING_KEY)?.trim()
    return raw && /^wss?:\/\//.test(raw) ? raw : null
  } catch {
    return null
  }
}

export function saveSignalingUrl(url: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (url && /^wss?:\/\//.test(url)) {
      window.localStorage.setItem(SAVED_SIGNALING_KEY, url)
    } else {
      window.localStorage.removeItem(SAVED_SIGNALING_KEY)
    }
  } catch {
    // 隐私模式忽略
  }
}

/**
 * 解析用户在联机面板输入的地址：
 * - `wss://...` 或 `https://...` → 规范为 `wss://.../signal`（公网信令，在当前页直接生效）
 * - 局域网 IP / `http://...` → 返回跳转地址 `{ kind: 'navigate', url }`（跳到电脑局域网服务）
 */
export function parseOnlineServerInput(raw: string):
  | { kind: 'signaling'; url: string }
  | { kind: 'navigate'; url: string }
  | null {
  const text = raw.trim()
  if (!text) return null
  if (/^wss?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text)
      if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/signal'
      return { kind: 'signaling', url: parsed.toString() }
    } catch {
      return null
    }
  }
  if (/^https:\/\//i.test(text)) {
    try {
      const parsed = new URL(text)
      parsed.protocol = 'wss:'
      if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/signal'
      return { kind: 'signaling', url: parsed.toString() }
    } catch {
      return null
    }
  }
  if (/^http:\/\//i.test(text)) {
    try {
      return { kind: 'navigate', url: new URL(text).toString() }
    } catch {
      return null
    }
  }
  // 裸 IP 或 IP:port（如 10.53.58.9 或 192.168.137.1:5173）
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/.*)?$/.test(text)) {
    const hasPort = /:\d{1,5}(?:\/|$)/.test(text)
    const normalized = hasPort ? `http://${text}` : `http://${text}:5173/`
    try {
      return { kind: 'navigate', url: new URL(normalized).toString() }
    } catch {
      return null
    }
  }
  // 裸域名（如 xxx.workers.dev）→ 按公网 wss 信令处理
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d{1,5})?(?:\/.*)?$/i.test(text)) {
    try {
      const parsed = new URL(`wss://${text}`)
      if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/signal'
      return { kind: 'signaling', url: parsed.toString() }
    } catch {
      return null
    }
  }
  return null
}

function isLanHostname(hostname: string): boolean {
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  return hostname.endsWith('.local')
}

export function getSelfHostConfig(): SelfHostConfig | null {
  const explicitUrl = query('selfHost') ?? env('VITE_SELF_HOST_SIGNALING')
  const autoLanUrl = !explicitUrl && typeof window !== 'undefined' && isLanHostname(window.location.hostname)
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/signal`
    : null
  const savedUrl = !explicitUrl && !autoLanUrl ? readSavedSignalingUrl() : null
  const signalingUrl = explicitUrl ?? autoLanUrl ?? savedUrl
  if (!signalingUrl || !/^wss?:\/\//.test(signalingUrl)) return null

  const iceServers: RTCIceServer[] = autoLanUrl
    ? []
    : [
        // 公共 STUN 兜底：多数家用网络能打洞直连；打不通时用 TURN 中继。
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
      ]
  const turn = query('turn') ?? env('VITE_TURN_SERVER')
  if (turn) {
    const parsed = parseTurnServer(turn)
    if (parsed) iceServers.push(parsed)
  }
  const stun = query('stun') ?? env('VITE_STUN_SERVER')
  if (stun) {
    const parsed = parseStunServer(stun)
    if (parsed) iceServers.push(parsed)
  }

  const relayAfterMs = queryNumber('selfHostRelayAfter')
    ?? (query('selfHostRelay') != null ? 1000 : undefined)
    ?? parseNumber(env('VITE_SELF_HOST_RELAY_AFTER'))
  const relayDurationMs = queryNumber('selfHostRelayDuration')
    ?? parseNumber(env('VITE_SELF_HOST_RELAY_DURATION'))

  return {
    signalingUrl,
    iceServers,
    peerId: query('selfHostPeer') ?? undefined,
    forceRelay: flag('forceRelay', 'VITE_FORCE_RELAY'),
    relayAfterMs,
    relayDurationMs,
  }
}
