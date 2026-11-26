// 局域网 WebSocket 直连房间：当信令服务器（scripts/lan-server.mjs）支持 `relay: true` 时，
// 业务消息直接走同一条局域网 WebSocket 转发，彻底绕开手机/Android 浏览器在 HTTP 非安全上下文
// 下 WebRTC mDNS `.local` 候选解析失败、随机 UDP 端口被防火墙拦截及 WebView 限制等问题。
import type { SignalingConnection } from './selfHostSignaling'

export function createWsRelayRoom(signaling: SignalingConnection): VibeHubSDK.Room {
  const isHost = signaling.peerId === signaling.hostId
  const messageHandlers: Array<(message: unknown, fromPeerId: string) => void> = []
  const peerHandlers: Array<(event: VibeHubSDK.PeerEvent) => void> = []
  const openPeers = new Set<string>()
  const unsubscribes: Array<() => void> = []
  let left = false

  if (isHost) {
    for (const member of signaling.initialMembers ?? []) {
      if (member !== signaling.peerId) openPeers.add(member)
    }
  } else if (signaling.hostId && signaling.hostId !== signaling.peerId) {
    openPeers.add(signaling.hostId)
  }

  const emitPeer = (event: VibeHubSDK.PeerEvent) => {
    if (left) return
    peerHandlers.forEach((handler) => handler(event))
  }
  const emitMessage = (message: unknown, fromPeerId: string) => {
    if (left) return
    messageHandlers.forEach((handler) => handler(message, fromPeerId))
  }

  unsubscribes.push(signaling.onEvent((event) => {
    if (left) return
    if (event.type === 'relay') {
      emitMessage(event.data, event.from)
    } else if (event.type === 'peer_join') {
      if (isHost && event.peerId !== signaling.peerId && !openPeers.has(event.peerId)) {
        openPeers.add(event.peerId)
        emitPeer({ type: 'join', id: event.peerId })
      }
    } else if (event.type === 'peer_leave') {
      if (openPeers.delete(event.peerId)) {
        emitPeer({ type: 'leave', id: event.peerId })
      }
    }
  }))

  unsubscribes.push(signaling.onClose(() => {
    if (left) return
    const dropped = [...openPeers]
    openPeers.clear()
    for (const id of dropped) {
      emitPeer({ type: 'leave', id })
    }
  }))

  function deliver(message: unknown, toPeerId?: string) {
    if (left) return
    if (toPeerId != null) {
      signaling.send({ type: 'relay', to: toPeerId, data: message })
    } else {
      signaling.send({ type: 'relay', data: message })
    }
  }

  const room: VibeHubSDK.Room = {
    roomId: signaling.roomId,
    peerId: signaling.peerId,
    topology: 'host',
    isHost,
    hostId: signaling.hostId,
    data: {} as VibeHubSDK.DataStore,
    state: {} as VibeHubSDK.StateManager,
    sync: {} as VibeHubSDK.SnapshotInterpolator,
    onMessage(callback) {
      messageHandlers.push(callback)
      return room
    },
    onPeer(callback) {
      peerHandlers.push(callback)
      return room
    },
    send(message, toPeerId) {
      deliver(message, toPeerId)
    },
    sendRealtime(message, toPeerId) {
      deliver(message, toPeerId)
    },
    peers() {
      return [...openPeers].map((id) => ({
        id,
        open: true,
        latency: 0,
        jitter: 0,
        relay: false,
        realtime: true,
        reconnecting: false,
      }))
    },
    networkStats() {
      return { state: 'direct' } as VibeHubSDK.NetworkStats
    },
    async diagnostics() {
      return { capturedAt: new Date().toISOString() } as VibeHubSDK.RoomDiagnostics
    },
    reconnect() { /* 局域网直连无需 WebRTC 重连 */ },
    async announce(metadata = {}) {
      const meta: VibeHubSDK.RoomMetadata = {
        roomId: signaling.roomId,
        players: openPeers.size + 1,
        hostPeerId: signaling.peerId,
        ...metadata,
      }
      signaling.send({ type: 'announce', meta })
      return { ok: true }
    },
    async close() {
      room.leave()
      return { ok: true }
    },
    leave() {
      if (left) return
      left = true
      openPeers.clear()
      unsubscribes.forEach((unsubscribe) => unsubscribe())
      unsubscribes.length = 0
      signaling.close()
    },
  }

  return room
}
