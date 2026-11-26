import { describe, expect, it } from 'vitest'
import { createWsRelayRoom } from './wsRelayRoom'
import type { SignalingConnection, SignalingEvent } from './selfHostSignaling'

interface FakeRelayHub {
  connect(peerId: string): SignalingConnection
  disconnect(peerId: string): void
}

function createFakeRelayHub(): FakeRelayHub {
  const members = new Map<string, {
    handlers: Set<(event: SignalingEvent) => void>
    closeHandlers: Set<() => void>
  }>()
  let hostId = ''

  function emit(peerId: string, event: SignalingEvent) {
    members.get(peerId)?.handlers.forEach((handler) => handler(event))
  }

  function disconnect(peerId: string) {
    const entry = members.get(peerId)
    if (!entry) return
    members.delete(peerId)
    entry.closeHandlers.forEach((handler) => handler())
    const nextHost = members.keys().next().value ?? null
    hostId = nextHost ?? ''
    for (const id of members.keys()) {
      emit(id, { type: 'peer_leave', peerId, hostId: nextHost })
    }
  }

  function connect(peerId: string): SignalingConnection {
    if (!hostId) hostId = peerId
    const entry = {
      handlers: new Set<(event: SignalingEvent) => void>(),
      closeHandlers: new Set<() => void>(),
    }
    const existingMembers = [...members.keys()]
    members.set(peerId, entry)
    for (const id of existingMembers) {
      emit(id, { type: 'peer_join', peerId })
    }
    const initialMembers = [...members.keys()]
    return {
      roomId: 'LAN123',
      peerId,
      hostId,
      relaySupported: true,
      initialMembers,
      send(message) {
        if (message.type === 'relay') {
          const to = typeof message.to === 'string' ? message.to : ''
          if (to) {
            emit(to, { type: 'relay', from: peerId, data: message.data })
          } else {
            for (const id of members.keys()) {
              if (id !== peerId) emit(id, { type: 'relay', from: peerId, data: message.data })
            }
          }
        }
      },
      onEvent(callback) {
        entry.handlers.add(callback)
        return () => { entry.handlers.delete(callback) }
      },
      onClose(callback) {
        entry.closeHandlers.add(callback)
        return () => { entry.closeHandlers.delete(callback) }
      },
      requestMeta: async () => null,
      close() {
        disconnect(peerId)
      },
    }
  }

  return { connect, disconnect }
}

describe('createWsRelayRoom', () => {
  it('房主与客户端不经 WebRTC 直接通过 WebSocket 收发广播与定向消息', () => {
    const hub = createFakeRelayHub()
    const hostRoom = createWsRelayRoom(hub.connect('host'))
    const hostEvents: VibeHubSDK.PeerEvent[] = []
    const hostReceived: Array<{ from: string; msg: unknown }> = []
    hostRoom.onPeer((e) => hostEvents.push(e))
    hostRoom.onMessage((msg, from) => hostReceived.push({ from, msg }))

    const clientA = createWsRelayRoom(hub.connect('android-a'))
    const clientB = createWsRelayRoom(hub.connect('android-b'))
    const receivedA: Array<{ from: string; msg: unknown }> = []
    const receivedB: Array<{ from: string; msg: unknown }> = []
    clientA.onMessage((msg, from) => receivedA.push({ from, msg }))
    clientB.onMessage((msg, from) => receivedB.push({ from, msg }))

    expect(hostRoom.isHost).toBe(true)
    expect(clientA.isHost).toBe(false)
    expect(clientA.peers().map((p) => p.id)).toEqual(['host'])
    expect(hostRoom.peers().map((p) => p.id)).toEqual(['android-a', 'android-b'])
    expect(hostEvents.map((e) => `${e.type}:${'id' in e ? e.id : ''}`)).toEqual(['join:android-a', 'join:android-b'])

    // 客户端 A 广播消息（如 lobby_hello / shuffle_commit），房主和客户端 B 都能收到
    clientA.send({ type: 'lobby_hello', nickname: '安卓A' })
    expect(hostReceived).toEqual([{ from: 'android-a', msg: { type: 'lobby_hello', nickname: '安卓A' } }])
    expect(receivedB).toEqual([{ from: 'android-a', msg: { type: 'lobby_hello', nickname: '安卓A' } }])
    expect(receivedA).toEqual([])

    // 房主定向发给客户端 A，客户端 B 不收到
    hostRoom.send({ type: 'lobby_seat_token', seat: 1, token: 'tok-a' }, 'android-a')
    expect(receivedA).toEqual([{ from: 'host', msg: { type: 'lobby_seat_token', seat: 1, token: 'tok-a' } }])
    expect(receivedB).toHaveLength(1)

    // 房主广播，两台安卓客户端都收到
    hostRoom.send({ type: 'lobby_roster', revision: 1 })
    expect(receivedA).toHaveLength(2)
    expect(receivedB).toHaveLength(2)
    expect(hostRoom.networkStats().state).toBe('direct')
  })

  it('客户端断线时房主收到 leave 并移除 peer', () => {
    const hub = createFakeRelayHub()
    const hostRoom = createWsRelayRoom(hub.connect('host'))
    const events: VibeHubSDK.PeerEvent[] = []
    hostRoom.onPeer((e) => events.push(e))

    const client = createWsRelayRoom(hub.connect('android-1'))
    expect(hostRoom.peers().map((p) => p.id)).toEqual(['android-1'])

    client.leave()
    expect(hostRoom.peers()).toEqual([])
    expect(events.map((e) => `${e.type}:${'id' in e ? e.id : ''}`)).toEqual(['join:android-1', 'leave:android-1'])
  })
})
