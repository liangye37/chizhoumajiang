// Cloudflare Workers + Durable Objects 房间 WebSocket 转发服务
// 免费额度即可承载好友日常联机：每个 6 位房间码独占一个 Durable Object，
// 协议与 scripts/lan-server.mjs 完全一致（welcome 带 relay: true，直接转发业务消息，
// 无需 WebRTC 打洞或 TURN，安卓/iOS/PC 浏览器及微信内均可直连）。

export interface Env {
  ROOMS: DurableObjectNamespace
}

interface Attachment {
  peerId: string
  roomId: string
  joinedAt: number
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    const url = new URL(request.url)

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ ok: true, service: 'chizhou-mahjong-relay', relay: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
      })
    }

    if (url.pathname !== '/signal') {
      return new Response('Not Found', { status: 404, headers: CORS_HEADERS })
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426, headers: CORS_HEADERS })
    }

    const roomId = (url.searchParams.get('room') || 'GLOBAL').trim().toUpperCase().slice(0, 16) || 'GLOBAL'
    const id = env.ROOMS.idFromName(roomId)
    return env.ROOMS.get(id).fetch(request)
  },
}

export class RoomRelay implements DurableObject {
  private meta: Record<string, unknown> | null = null
  private state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.state.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  private orderedSockets(): Array<{ ws: WebSocket; att: Attachment }> {
    const list: Array<{ ws: WebSocket; att: Attachment }> = []
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (att && att.peerId) list.push({ ws, att })
    }
    list.sort((a, b) => a.att.joinedAt - b.att.joinedAt)
    return list
  }

  private sendJson(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj))
    } catch {
      // 对端已断开时忽略
    }
  }

  private broadcast(obj: unknown, excludePeerId?: string): void {
    for (const { ws, att } of this.orderedSockets()) {
      if (excludePeerId && att.peerId === excludePeerId) continue
      this.sendJson(ws, obj)
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    const type = msg.type

    if (type === 'join') {
      const roomId = String(msg.roomId ?? '').trim().toUpperCase()
      if (!roomId) {
        this.sendJson(ws, { type: 'error', message: '缺少 roomId' })
        return
      }
      const peerId = String(msg.peerId ?? '').trim() || `p-${crypto.randomUUID().slice(0, 12)}`
      const att: Attachment = { peerId, roomId, joinedAt: Date.now() }
      ws.serializeAttachment(att)

      const members = this.orderedSockets()
      const hostId = members[0]?.att.peerId ?? peerId
      this.sendJson(ws, {
        type: 'welcome',
        peerId,
        roomId,
        hostId,
        members: members.map((item) => item.att.peerId),
        relay: true,
      })
      this.broadcast({ type: 'peer_join', peerId }, peerId)
      return
    }

    const att = ws.deserializeAttachment() as Attachment | null
    if (!att?.peerId) return

    if (type === 'relay') {
      const to = typeof msg.to === 'string' ? msg.to.trim() : ''
      if (to) {
        const target = this.orderedSockets().find((item) => item.att.peerId === to)
        if (target) this.sendJson(target.ws, { type: 'relay', from: att.peerId, data: msg.data })
      } else {
        this.broadcast({ type: 'relay', from: att.peerId, data: msg.data }, att.peerId)
      }
      return
    }

    if (type === 'signal') {
      const to = typeof msg.to === 'string' ? msg.to.trim() : ''
      if (!to) return
      const target = this.orderedSockets().find((item) => item.att.peerId === to)
      if (target) this.sendJson(target.ws, { type: 'signal', from: att.peerId, data: msg.data })
      return
    }

    if (type === 'announce') {
      const hostId = this.orderedSockets()[0]?.att.peerId
      if (hostId === att.peerId) {
        this.meta = (msg.meta && typeof msg.meta === 'object') ? (msg.meta as Record<string, unknown>) : null
      }
      this.sendJson(ws, { type: 'announce_ok' })
      return
    }

    if (type === 'meta_req') {
      this.sendJson(ws, { type: 'meta', meta: this.meta })
      return
    }

    if (type === 'leave') {
      try { ws.close(1000, 'leave') } catch { /* noop */ }
      this.handleDisconnect(ws)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.handleDisconnect(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.handleDisconnect(ws)
  }

  private handleDisconnect(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as Attachment | null
    if (!att?.peerId) return
    ws.serializeAttachment(null)
    const remaining = this.orderedSockets().filter((item) => item.ws !== ws)
    if (remaining.length === 0) {
      this.meta = null
      return
    }
    const nextHostId = remaining[0]?.att.peerId ?? null
    for (const item of remaining) {
      this.sendJson(item.ws, { type: 'peer_leave', peerId: att.peerId, hostId: nextHostId })
    }
  }
}
