// 承诺洗牌（Phase 4 反作弊威慑）：多方先提交「种子承诺」、再揭晓种子，共同确定性派生
// 牌墙与骰点，防止房主单方面控制洗牌/骰点。诚实说明：这防「做牌/控骰」，不防「看牌」——
// 房主最终要拿整副墙发牌，发完即全知，这是 P2P 暗牌博弈的物理上限。
//
// 协议：
// 1. 每家生成种子 sᵢ，广播承诺 cᵢ = hash(seat: sᵢ)
// 2. 收齐所有承诺后各自揭晓 sᵢ
// 3. 校验每个 hash 与承诺一致，用 combineSeeds 派生墙与骰点
import type { TileType } from '../../core/contracts/types'

export interface ShuffleCommitMessage { type: 'shuffle_commit'; roundId: string; seat: number; commitment: string; authorityEpoch?: string }
export interface ShuffleRevealMessage { type: 'shuffle_reveal'; roundId: string; seat: number; seed: string; authorityEpoch?: string }
export interface ShuffleParticipant {
  seat: number
  peerId: string
}

export interface ShuffleStartMessage {
  type: 'round_shuffle_start'
  roomId: string
  round: number
  /** 连庄时 round 不变，必须用 honba 区分合法新手与旧洗牌消息。 */
  honba: number
  roundId: string
  /** 本轮实际参与承诺的座位；掉线并已由 AI 接管的座位不在其中。 */
  seats: number[]
  /** 房主在本轮开始时锁定的实际 peer → seat 映射；客户端不得用旧 roster 反推。 */
  participants: ShuffleParticipant[]
  seatCount: number
  /** 后续局绑定当前房主引擎生命周期；首局大厅消息可不带。 */
  authorityEpoch?: string
}

function isCommit(message: unknown): message is ShuffleCommitMessage {
  return typeof message === 'object' && message !== null
    && (message as { type?: unknown }).type === 'shuffle_commit'
    && typeof (message as { roundId?: unknown }).roundId === 'string'
    && (message as { roundId: string }).roundId.length > 0
    && Number.isInteger((message as { seat?: unknown }).seat)
    && typeof (message as { commitment?: unknown }).commitment === 'string'
    && (message as { commitment: string }).commitment.length > 0
    && ((message as { authorityEpoch?: unknown }).authorityEpoch === undefined
      || (typeof (message as { authorityEpoch?: unknown }).authorityEpoch === 'string'
        && (message as { authorityEpoch: string }).authorityEpoch.length > 0))
}

function isReveal(message: unknown): message is ShuffleRevealMessage {
  return typeof message === 'object' && message !== null
    && (message as { type?: unknown }).type === 'shuffle_reveal'
    && typeof (message as { roundId?: unknown }).roundId === 'string'
    && (message as { roundId: string }).roundId.length > 0
    && Number.isInteger((message as { seat?: unknown }).seat)
    && typeof (message as { seed?: unknown }).seed === 'string'
    && (message as { seed: string }).seed.length > 0
    && ((message as { authorityEpoch?: unknown }).authorityEpoch === undefined
      || (typeof (message as { authorityEpoch?: unknown }).authorityEpoch === 'string'
        && (message as { authorityEpoch: string }).authorityEpoch.length > 0))
}

// ── 纯函数（可独立测试） ──────────────────────────────────

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** 纯 JS SHA-256（FIPS 180-4），保证 HTTP 局域网非安全上下文与 localhost/HTTPS 哈希完全一致。 */
export function sha256HexFallback(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false)
  view.setUint32(paddedLen - 4, bitLen >>> 0, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, '0')).join('')
}

export async function hashSeed(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return sha256HexFallback(input)
}

/** mulberry32：由字符串种子派生确定性 PRNG。 */
function createRng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffleTiles<T>(tiles: readonly T[], seed: string): T[] {
  const rng = createRng(seed)
  const result = [...tiles]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}

export function deriveDice(seed: string): [number, number] {
  const rng = createRng(`${seed}:dice`)
  return [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)]
}

/** 合并各家种子（排序后拼接），保证与座位顺序无关、各家派生一致。 */
export function combineSeeds(seeds: string[]): string {
  return [...seeds].sort().join('|')
}

// ── 协调层（经 SDK Room 的 P2P 消息交换） ────────────────

export interface CommittedShuffleOptions {
  room: VibeHubSDK.Room
  roundId: string
  seatCount: number
  mySeat: number
  /** 后续局必须绑定当前房主代次；首局大厅洗牌可省略。 */
  authorityEpoch?: string
  /** peerId → seat，必须包含房主和所有实际参与承诺的玩家。 */
  seatByPeer: Map<string, number>
  tiles: readonly TileType[]
  onComplete: (wall: TileType[], dice: [number, number], secondDice: [number, number]) => void
  onError?: (reason: string) => void
  /** 承诺超时时告知协调层哪些参与者没有提交，允许掉线座位切 AI 后重试本轮。 */
  onTimeout?: (missingSeats: number[]) => void
  randomSeed?: () => string
  timeoutMs?: number
}

function defaultRandomSeed(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function runCommittedShuffle(options: CommittedShuffleOptions): void {
  const {
    room,
    roundId,
    seatCount,
    mySeat,
    authorityEpoch,
    seatByPeer,
    tiles,
    onComplete,
    onError,
    onTimeout,
    randomSeed = defaultRandomSeed,
    timeoutMs = 15000,
  } = options
  const commitments = new Map<number, string>()
  const seeds = new Map<number, string>()
  let revealed = false
  let finished = false

  const expectedSeats = new Set([...seatByPeer.values()])
  const participantCount = expectedSeats.size

  // 参与者映射本身也是房主锁定的协议输入。重复座位、越界座位或空轮次不能
  // 被当成“少一个人”的正常洗牌，否则会把错误映射静默降级成不完整的牌局。
  if (
    !roundId
    || !Number.isInteger(seatCount) || seatCount < 1 || seatCount > 4
    || !Number.isInteger(mySeat) || mySeat < 0 || mySeat >= seatCount
    || participantCount < 1
    || [...expectedSeats].some((seat) => !Number.isInteger(seat) || seat < 0 || seat >= seatCount)
    || expectedSeats.size !== seatByPeer.size
    || (authorityEpoch !== undefined && !authorityEpoch)
  ) {
    onError?.('洗牌参与者映射无效')
    return
  }

  function validSeat(seat: number): boolean {
    return Number.isInteger(seat) && seat >= 0 && seat < seatCount && expectedSeats.has(seat)
  }

  function fail(reason: string) {
    if (finished) return
    finished = true
    clearTimeout(timeout)
    onError?.(reason)
  }

  function checkCommitPhase() {
    if (commitments.size < participantCount || revealed || finished) return
    revealed = true
    room.send({
      type: 'shuffle_reveal',
      roundId,
      seat: mySeat,
      seed: seeds.get(mySeat) ?? '',
      ...(authorityEpoch ? { authorityEpoch } : {}),
    } satisfies ShuffleRevealMessage)
    checkRevealPhase()
  }

  async function checkRevealPhase() {
    if (seeds.size < participantCount || finished) return
    // 校验所有承诺
    const entries = [...commitments.entries()].sort((a, b) => a[0] - b[0])
    for (const [seat, commitment] of entries) {
      const seed = seeds.get(seat) ?? ''
      if ((await hashSeed(`${seat}:${seed}`)) !== commitment) {
        fail(`洗牌校验失败（seat ${seat} 承诺不一致）`)
        return
      }
    }
    const combined = combineSeeds(entries.map(([seat, seed]) => `${seat}:${seed}`))
    finished = true
    onComplete(shuffleTiles(tiles, combined), deriveDice(`${combined}:first`), deriveDice(`${combined}:second`))
  }

  const timeout = setTimeout(() => {
    // 本地承诺可能仍在异步 hash 中；超时恢复只针对远端参与者，不能把
    // 自己也报告成“掉线座位”，否则房主会得到误导性的缺席名单。
    onTimeout?.([...expectedSeats].filter((seat) => seat !== mySeat && !commitments.has(seat)))
    fail(`洗牌承诺超时（${timeoutMs}ms 内未完成）`)
  }, timeoutMs)

  room.onMessage((message, fromPeerId) => {
    if (finished || typeof fromPeerId !== 'string') return
    if (isCommit(message)) {
      if (message.roundId !== roundId || !validSeat(message.seat)) return
      // 首局没有房主引擎代次时，也不能接受带着其它代次的迟到消息；
      // 后续局则必须精确匹配当前代次。否则旧 Room 的承诺可能混入新屏障。
      if (authorityEpoch ? message.authorityEpoch !== authorityEpoch : message.authorityEpoch !== undefined) return
      if (seatByPeer.get(fromPeerId) !== message.seat) {
        fail(`洗牌承诺来源与座位不匹配（peer ${fromPeerId}）`)
        return
      }
      const previous = commitments.get(message.seat)
      if (previous && previous !== message.commitment) {
        fail(`洗牌承诺重复且内容冲突（seat ${message.seat}）`)
        return
      }
      commitments.set(message.seat, message.commitment)
      checkCommitPhase()
    } else if (isReveal(message)) {
      if (message.roundId !== roundId || !validSeat(message.seat)) return
      if (authorityEpoch ? message.authorityEpoch !== authorityEpoch : message.authorityEpoch !== undefined) return
      if (seatByPeer.get(fromPeerId) !== message.seat) {
        fail(`洗牌揭晓来源与座位不匹配（peer ${fromPeerId}）`)
        return
      }
      const previous = seeds.get(message.seat)
      if (previous && previous !== message.seed) {
        fail(`洗牌揭晓重复且内容冲突（seat ${message.seat}）`)
        return
      }
      seeds.set(message.seat, message.seed)
      void checkRevealPhase()
    }
  })

  void (async () => {
    const mySeed = randomSeed()
    if (!mySeed || !validSeat(mySeat) || seatByPeer.get(room.peerId) !== mySeat) {
      fail('洗牌本地座位映射无效')
      return
    }
    seeds.set(mySeat, mySeed)
    const myCommitment = await hashSeed(`${mySeat}:${mySeed}`)
    if (finished) return
    commitments.set(mySeat, myCommitment)
    room.send({
      type: 'shuffle_commit',
      roundId,
      seat: mySeat,
      commitment: myCommitment,
      ...(authorityEpoch ? { authorityEpoch } : {}),
    } satisfies ShuffleCommitMessage)
    checkCommitPhase()
  })()
}
