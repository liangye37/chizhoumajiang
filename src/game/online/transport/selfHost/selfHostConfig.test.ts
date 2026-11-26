import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSelfHostConfig, parseOnlineServerInput } from './selfHostConfig'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getSelfHostConfig', () => {
  it('未配置信令地址时返回 null', () => {
    vi.stubEnv('VITE_SELF_HOST_SIGNALING', '')
    expect(getSelfHostConfig()).toBeNull()
  })

  it('从 env 读取信令地址与 TURN（含凭据）', () => {
    vi.stubEnv('VITE_SELF_HOST_SIGNALING', 'wss://sig.example.com')
    vi.stubEnv('VITE_TURN_SERVER', 'turn:alice:s3cret@turn.example.com:3478')
    const config = getSelfHostConfig()
    expect(config?.signalingUrl).toBe('wss://sig.example.com')
    expect(config?.iceServers).toContainEqual({
      urls: 'turn:turn.example.com:3478',
      username: 'alice',
      credential: 's3cret',
    })
  })

  it('非法信令地址返回 null', () => {
    vi.stubEnv('VITE_SELF_HOST_SIGNALING', 'http-not-websocket')
    expect(getSelfHostConfig()).toBeNull()
  })
})

describe('parseOnlineServerInput', () => {
  it('把 https/wss/裸域名规范为 wss://.../signal', () => {
    expect(parseOnlineServerInput('https://relay.example.workers.dev')).toEqual({
      kind: 'signaling',
      url: 'wss://relay.example.workers.dev/signal',
    })
    expect(parseOnlineServerInput('wss://relay.example.workers.dev/signal')).toEqual({
      kind: 'signaling',
      url: 'wss://relay.example.workers.dev/signal',
    })
    expect(parseOnlineServerInput('relay.example.workers.dev')).toEqual({
      kind: 'signaling',
      url: 'wss://relay.example.workers.dev/signal',
    })
  })

  it('把局域网 IP 和 http 地址解析为跳转目标', () => {
    expect(parseOnlineServerInput('10.53.58.9')).toEqual({
      kind: 'navigate',
      url: 'http://10.53.58.9:5173/',
    })
    expect(parseOnlineServerInput('http://192.168.137.1:5173/')).toEqual({
      kind: 'navigate',
      url: 'http://192.168.137.1:5173/',
    })
  })
})
