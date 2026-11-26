// 自托管信令连接：封装与 signaling/server.py 的 WebSocket 会话。
// 只做「握手」——join 拿 peerId/hostId、中转 SDP/ICE、查询房间元数据、感知成员进出。
// 业务消息不走这里（走 WebRTC DataChannel）。

export type SignalingEvent =
  | { type: 'welcome'; peerId: string; roomId: string; hostId: string; members: string[]; relay?: boolean }
  | { type: 'peer_join'; peerId: string }
  | { type: 'peer_leave'; peerId: string; hostId: string | null }
  | { type: 'signal'; from: string; data: unknown }
  | { type: 'relay'; from: string; data: unknown }
  | { type: 'meta'; meta: Record<string, unknown> | null }
  | { type: 'error'; message: string }

export interface SignalingConnection {
  readonly roomId: string
  readonly peerId: string
  readonly hostId: string
  /** 服务端是否支持直接通过 WebSocket 转发房间消息（局域网一体服务器为 true）。 */
  readonly relaySupported?: boolean
  /** welcome 时房间内已有成员列表。 */
  readonly initialMembers?: readonly string[]
  send(message: Record<string, unknown>): void
  onEvent(callback: (event: SignalingEvent) => void): () => void
  onClose(callback: () => void): () => void
  requestMeta(timeoutMs?: number): Promise<Record<string, unknown> | null>
  close(): void
}

const JOIN_TIMEOUT_MS = 8000
const META_TIMEOUT_MS = 4000
const HEARTBEAT_INTERVAL_MS = 15000
const PONG_TIMEOUT_MS = 12000
const RECONNECT_DELAYS_MS = [300, 1000, 2000, 3000, 5000, 5000, 5000, 5000]
const MAX_PENDING_QUEUE = 32

function withRoomQuery(url: string, roomId: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has('room')) {
      parsed.searchParams.set('room', roomId.toUpperCase())
    }
    return parsed.toString()
  } catch {
    return url
  }
}

/** 连接信令服务器并加入房间；resolve 于收到 welcome（peerId/hostId 已确定）。
 *  建连成功后自动维持 15s 心跳保活，并在手机切网/偶发断连时使用同一 peerId 静默重连。 */
export function openSignaling(
  url: string,
  roomId: string,
  peerId: string,
): Promise<SignalingConnection> {
  return new Promise((resolve, reject) => {
    const targetUrl = withRoomQuery(url, roomId)
    const eventHandlers = new Set<(event: SignalingEvent) => void>()
    const closeHandlers = new Set<() => void>()
    const pendingQueue: string[] = []
    let ws: WebSocket | null = null
    let hostId = ''
    let relaySupported = false
    let initialMembers: string[] = []
    let opened = false
    let settled = false
    let manuallyClosed = false
    let closeEmitted = false
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let pongTimer: ReturnType<typeof setTimeout> | null = null

    const joinTimer = setTimeout(() => fail(new Error('信令握手超时')), JOIN_TIMEOUT_MS)

    function clearHeartbeat() {
      if (heartbeatTimer != null) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      if (pongTimer != null) { clearTimeout(pongTimer); pongTimer = null }
    }

    function clearReconnectTimer() {
      if (reconnectTimer != null) { clearTimeout(reconnectTimer); reconnectTimer = null }
    }

    function startHeartbeat() {
      clearHeartbeat()
      heartbeatTimer = setInterval(() => {
        if (manuallyClosed || !ws || ws.readyState !== WebSocket.OPEN) return
        try { ws.send('{"type":"ping"}') } catch { return }
        if (pongTimer != null) clearTimeout(pongTimer)
        pongTimer = setTimeout(() => {
          pongTimer = null
          // 12s 未收到任何服务端消息/pong → 判定半开死链，主动触发快速重连
          if (!manuallyClosed && ws) {
            try { ws.close() } catch { /* noop */ }
          }
        }, PONG_TIMEOUT_MS)
      }, HEARTBEAT_INTERVAL_MS)
    }

    function fail(error: Error) {
      if (settled) return
      settled = true
      clearTimeout(joinTimer)
      clearHeartbeat()
      clearReconnectTimer()
      try { ws?.close() } catch { /* noop */ }
      reject(error)
    }

    function dispatch(event: SignalingEvent) {
      eventHandlers.forEach((handler) => handler(event))
    }

    function emitClose() {
      if (closeEmitted) return
      closeEmitted = true
      clearHeartbeat()
      clearReconnectTimer()
      closeHandlers.forEach((handler) => handler())
    }

    function flushQueue() {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      while (pendingQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
        const next = pendingQueue.shift()!
        try { ws.send(next) } catch { break }
      }
    }

    function scheduleReconnect() {
      if (manuallyClosed || closeEmitted || !settled) return
      if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
        emitClose()
        return
      }
      const delay = RECONNECT_DELAYS_MS[reconnectAttempt++]
      clearReconnectTimer()
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (!manuallyClosed && !closeEmitted) connectSocket()
      }, delay)
    }

    function connectSocket() {
      let socket: WebSocket
      try {
        socket = new WebSocket(targetUrl)
      } catch (error) {
        if (!settled) fail(error instanceof Error ? error : new Error(String(error)))
        else scheduleReconnect()
        return
      }
      ws = socket
      opened = false

      socket.onopen = () => {
        if (ws !== socket) { try { socket.close() } catch {} return }
        opened = true
        socket.send(JSON.stringify({ type: 'join', roomId, peerId }))
      }

      socket.onmessage = (raw) => {
        if (ws !== socket) return
        if (pongTimer != null) { clearTimeout(pongTimer); pongTimer = null }
        let message: unknown
        try { message = JSON.parse(String(raw.data)) } catch { return }
        if (typeof message !== 'object' || message === null) return
        if ((message as { type?: unknown }).type === 'pong') return
        const event = message as Partial<SignalingEvent>

        if (event.type === 'welcome') {
          const welcome = event as { hostId?: string; relay?: unknown; members?: unknown }
          hostId = welcome.hostId ?? peerId
          relaySupported = welcome.relay === true
          initialMembers = Array.isArray(welcome.members)
            ? welcome.members.filter((item): item is string => typeof item === 'string')
            : []
          reconnectAttempt = 0
          startHeartbeat()
          if (!settled) {
            settled = true
            clearTimeout(joinTimer)
            resolve(connection)
          }
          flushQueue()
          dispatch(event as SignalingEvent)
          return
        }
        dispatch(event as SignalingEvent)
      }

      socket.onerror = () => {
        if (ws !== socket) return
        if (!settled) fail(new Error('信令连接失败'))
      }

      socket.onclose = () => {
        if (ws !== socket) return
        opened = false
        clearHeartbeat()
        if (!settled) {
          fail(new Error('信令连接关闭'))
          return
        }
        if (manuallyClosed) {
          emitClose()
          return
        }
        // 移动端网络抖动/边缘节点重置：静默快速重连，不立刻踢出房间。
        scheduleReconnect()
      }
    }

    const connection: SignalingConnection = {
      roomId,
      peerId,
      get hostId() { return hostId },
      get relaySupported() { return relaySupported },
      get initialMembers() { return initialMembers },
      send(message) {
        const text = JSON.stringify(message)
        if (opened && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(text)
          return
        }
        // 仅在已建连后的短暂重连窗口缓存业务消息，重连成功立刻补发。
        if (settled && !manuallyClosed && !closeEmitted && message.type === 'relay') {
          if (pendingQueue.length >= MAX_PENDING_QUEUE) pendingQueue.shift()
          pendingQueue.push(text)
        }
      },
      onEvent(callback) {
        eventHandlers.add(callback)
        return () => { eventHandlers.delete(callback) }
      },
      onClose(callback) {
        closeHandlers.add(callback)
        return () => { closeHandlers.delete(callback) }
      },
      requestMeta(timeoutMs = META_TIMEOUT_MS) {
        return new Promise<Record<string, unknown> | null>((resolveMeta) => {
          let done = false
          const finish = (value: Record<string, unknown> | null) => {
            if (done) return
            done = true
            unsubscribe()
            clearTimeout(timer)
            resolveMeta(value)
          }
          const unsubscribe = connection.onEvent((event) => {
            if (event.type === 'meta') finish(event.meta)
          })
          const timer = setTimeout(() => finish(null), timeoutMs)
          connection.send({ type: 'meta_req' })
        })
      },
      close() {
        manuallyClosed = true
        pendingQueue.length = 0
        clearHeartbeat()
        clearReconnectTimer()
        try { ws?.close() } catch { /* noop */ }
        emitClose()
      },
    }

    connectSocket()
  })
}
