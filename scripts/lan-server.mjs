#!/usr/bin/env node
/**
 * 局域网 / 热点联机一体服务器（零外部依赖，仅用 Node 内置模块）：
 * - 静态托管 dist/（端口默认 5173，监听 0.0.0.0）
 * - 同端口 /signal 提供与 signaling/server.py 完全兼容的 WebSocket 信令服务
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist')
const port = Number(process.env.PORT || 5173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

function isPrivateLanIpv4(ip) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
}

function lanPriority(name, ip) {
  if (ip.startsWith('192.168.137.')) return 0
  if (/vethernet|wsl|docker|vmware|virtualbox|vbox|hyper-v|mihomo|clash|meta|tun|tap/i.test(name)) return 4
  if (/wlan|wi-fi|wifi|wireless|无线/i.test(name)) return 1
  if (ip.startsWith('192.168.')) return 2
  return 3
}

function getLanUrls() {
  const ifaces = os.networkInterfaces()
  const entries = []
  for (const [name, list] of Object.entries(ifaces)) {
    for (const info of list || []) {
      if (info.family === 'IPv4' && !info.internal && isPrivateLanIpv4(info.address)) {
        entries.push({ name, address: info.address })
      }
    }
  }
  entries.sort((a, b) => lanPriority(a.name, a.address) - lanPriority(b.name, b.address))
  return entries.map((entry) => `http://${entry.address}:${port}/`)
}

// ── RFC 6455 极简 WebSocket 封装 ─────────────────────────────────────────
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function encodeFrame(opcode, payloadBuf) {
  const len = payloadBuf.length
  let header
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x80 | opcode
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payloadBuf])
}

function wrapWebSocket(socket) {
  let closed = false
  let closeEmitted = false
  let buffer = Buffer.alloc(0)
  let fragmentedChunks = null
  let alive = true
  const listeners = { message: [], close: [] }

  const pingTimer = setInterval(() => {
    if (closed || socket.destroyed) return
    if (!alive) {
      socket.destroy()
      emitClose()
      return
    }
    alive = false
    try { socket.write(encodeFrame(0x9, Buffer.alloc(0))) } catch {}
  }, 20000)

  function emitClose() {
    if (closeEmitted) return
    closeEmitted = true
    closed = true
    clearInterval(pingTimer)
    for (const fn of listeners.close) fn()
  }

  const ws = {
    send(obj) {
      if (closed || socket.destroyed) return
      try {
        const text = typeof obj === 'string' ? obj : JSON.stringify(obj)
        socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')))
      } catch {}
    },
    close() {
      if (!closed) {
        closed = true
        clearInterval(pingTimer)
        try { socket.write(encodeFrame(0x8, Buffer.alloc(0))) } catch {}
        socket.end()
      }
      emitClose()
    },
    on(event, fn) {
      listeners[event]?.push(fn)
    },
  }

  socket.on('data', (chunk) => {
    alive = true
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 2) {
      const b0 = buffer[0]
      const b1 = buffer[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let payloadLen = b1 & 0x7f
      let offset = 2
      if (payloadLen === 126) {
        if (buffer.length < 4) return
        payloadLen = buffer.readUInt16BE(2)
        offset = 4
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return
        payloadLen = Number(buffer.readBigUInt64BE(2))
        offset = 10
      }
      const totalLen = offset + (masked ? 4 : 0) + payloadLen
      if (buffer.length < totalLen) return

      let payload = buffer.subarray(offset + (masked ? 4 : 0), totalLen)
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4)
        const unmasked = Buffer.allocUnsafe(payloadLen)
        for (let i = 0; i < payloadLen; i += 1) unmasked[i] = payload[i] ^ mask[i & 3]
        payload = unmasked
      }
      buffer = buffer.subarray(totalLen)

      if (opcode === 0x8) {
        ws.close()
        emitClose()
        return
      }
      if (opcode === 0x9) {
        if (!closed && !socket.destroyed) socket.write(encodeFrame(0xa, payload))
        continue
      }
      if (opcode === 0xa) {
        alive = true
        continue
      }
      if (opcode === 0x1) {
        if (fin) {
          fragmentedChunks = null
          const text = payload.toString('utf8')
          for (const fn of listeners.message) fn(text)
        } else {
          fragmentedChunks = [payload]
        }
        continue
      }
      if (opcode === 0x0 && fragmentedChunks) {
        fragmentedChunks.push(payload)
        if (fin) {
          const text = Buffer.concat(fragmentedChunks).toString('utf8')
          fragmentedChunks = null
          for (const fn of listeners.message) fn(text)
        }
      }
    }
  })
  socket.on('close', emitClose)
  socket.on('error', emitClose)
  return ws
}

// ── 信令房间管理（与 signaling/server.py 同协议）─────────────────────────
/** @type {Map<string, { members: Map<string, ReturnType<typeof wrapWebSocket>>, meta: unknown }>} */
const rooms = new Map()

function hostIdOf(room) {
  return room.members.keys().next().value ?? null
}

function broadcast(room, payload, excludePeerId = null) {
  for (const [peerId, peerWs] of room.members.entries()) {
    if (peerId !== excludePeerId) peerWs.send(payload)
  }
}

function attachSignaling(ws) {
  let roomId = null
  let peerId = null

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'ping') {
      ws.send({ type: 'pong' })
      return
    }

    if (msg.type === 'join') {
      const nextRoomId = String(msg.roomId ?? '').trim().toUpperCase()
      if (!nextRoomId) {
        ws.send({ type: 'error', message: '缺少 roomId' })
        return
      }
      const nextPeerId = String(msg.peerId ?? '').trim() || `p-${crypto.randomBytes(6).toString('hex')}`
      roomId = nextRoomId
      peerId = nextPeerId
      let room = rooms.get(roomId)
      if (!room) {
        room = { members: new Map(), meta: null }
        rooms.set(roomId, room)
      }
      room.members.set(peerId, ws)
      ws.send({
        type: 'welcome',
        peerId,
        roomId,
        hostId: hostIdOf(room),
        members: [...room.members.keys()],
        relay: true,
      })
      broadcast(room, { type: 'peer_join', peerId }, peerId)
      return
    }

    if (msg.type === 'relay') {
      if (!roomId || !peerId) return
      const room = rooms.get(roomId)
      if (!room) return
      const to = typeof msg.to === 'string' ? msg.to.trim() : ''
      if (to) {
        const target = room.members.get(to)
        if (target) target.send({ type: 'relay', from: peerId, data: msg.data })
      } else {
        broadcast(room, { type: 'relay', from: peerId, data: msg.data }, peerId)
      }
      return
    }

    if (msg.type === 'signal') {
      const to = String(msg.to ?? '').trim()
      if (!roomId || !peerId || !to) return
      const room = rooms.get(roomId)
      const target = room?.members.get(to)
      if (target) target.send({ type: 'signal', from: peerId, data: msg.data })
      return
    }

    if (msg.type === 'announce') {
      if (!roomId || !peerId) return
      const room = rooms.get(roomId)
      if (room && hostIdOf(room) === peerId) room.meta = msg.meta ?? null
      ws.send({ type: 'announce_ok' })
      return
    }

    if (msg.type === 'meta_req') {
      if (!roomId) return
      const room = rooms.get(roomId)
      ws.send({ type: 'meta', meta: room?.meta ?? null })
      return
    }

    if (msg.type === 'leave') {
      ws.close()
    }
  })

  ws.on('close', () => {
    if (!roomId || !peerId) return
    const room = rooms.get(roomId)
    if (!room) return
    if (room.members.delete(peerId)) {
      if (room.members.size === 0) {
        rooms.delete(roomId)
      } else {
        broadcast(room, { type: 'peer_leave', peerId, hostId: hostIdOf(room) })
      }
    }
  })
}

// ── HTTP 静态服务 + /signal 升级 ────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (url.pathname === '/api/lan-info') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ urls: getLanUrls() }))
    return
  }

  let reqPath = decodeURIComponent(url.pathname)
  if (reqPath === '/') reqPath = '/index.html'
  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(distDir, safePath)

  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html')
  }
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  })
  fs.createReadStream(filePath).pipe(res)
})

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (url.pathname !== '/signal') {
    socket.destroy()
    return
  }
  const key = req.headers['sec-websocket-key']
  if (!key) {
    socket.destroy()
    return
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  attachSignaling(wrapWebSocket(socket))
})

server.listen(port, '0.0.0.0', () => {
  const urls = getLanUrls()
  console.log(`[LAN] 池州麻将局域网联机服务已启动 (port ${port})`)
  console.log(`[LAN] 本机访问: http://localhost:${port}/?selfHost=ws://127.0.0.1:${port}/signal`)
  for (const u of urls) console.log(`[LAN] 局域网/热点访问: ${u}`)
})
