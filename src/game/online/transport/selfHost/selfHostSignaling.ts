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

/** 连接信令服务器并加入房间；resolve 于收到 welcome（peerId/hostId 已确定）。 */
export function openSignaling(
  url: string,
  roomId: string,
  peerId: string,
): Promise<SignalingConnection> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    const eventHandlers = new Set<(event: SignalingEvent) => void>()
    const closeHandlers = new Set<() => void>()
    let hostId = ''
    let relaySupported = false
    let initialMembers: string[] = []
    let opened = false
    let settled = false
    let closed = false

    const joinTimer = setTimeout(() => fail(new Error('信令握手超时')), JOIN_TIMEOUT_MS)

    function fail(error: Error) {
      if (settled) return
      settled = true
      clearTimeout(joinTimer)
      try { ws.close() } catch { /* noop */ }
      reject(error)
    }

    function dispatch(event: SignalingEvent) {
      eventHandlers.forEach((handler) => handler(event))
    }

    function emitClose() {
      if (closed) return
      closed = true
      closeHandlers.forEach((handler) => handler())
    }

    const connection: SignalingConnection = {
      roomId,
      peerId,
      get hostId() { return hostId },
      get relaySupported() { return relaySupported },
      get initialMembers() { return initialMembers },
      send(message) {
        if (opened && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message))
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
        try { ws.close() } catch { /* noop */ }
      },
    }

    ws.onopen = () => {
      opened = true
      ws.send(JSON.stringify({ type: 'join', roomId, peerId }))
    }

    ws.onmessage = (raw) => {
      let message: unknown
      try { message = JSON.parse(String(raw.data)) } catch { return }
      if (typeof message !== 'object' || message === null) return
      const event = message as Partial<SignalingEvent>

      if (event.type === 'welcome') {
        const welcome = event as { hostId?: string; relay?: unknown; members?: unknown }
        hostId = welcome.hostId ?? peerId
        relaySupported = welcome.relay === true
        initialMembers = Array.isArray(welcome.members)
          ? welcome.members.filter((item): item is string => typeof item === 'string')
          : []
        if (!settled) {
          settled = true
          clearTimeout(joinTimer)
          resolve(connection)
        }
        dispatch(event as SignalingEvent)
        return
      }
      dispatch(event as SignalingEvent)
    }

    ws.onerror = () => fail(new Error('信令连接失败'))

    ws.onclose = () => {
      if (!settled) fail(new Error('信令连接关闭'))
      emitClose()
    }
  })
}
