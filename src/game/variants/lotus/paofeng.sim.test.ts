import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TileType } from '../../core/contracts/types'
import { createWall } from '../../core/rules/tiles'
import { resolveRoundResultPresentation } from '../../../theme/themeEventPresentation'
import { useLotusGame } from './lotusGame'

function stubWindow() {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function buildPaofengRingWall(seat0DrawTile: TileType, seat1To3DrawTiles: [TileType, TileType, TileType]) {
  // 固定 dealer=3, openingSecondDice=[1,1] => 下家(seat 0)跳过1墩 flipStack=15, openingStack=19
  // 将 136 张标准牌按需要填入开牌顺位（从 stack 19 开始顺时针）
  const pool = createWall()
  const take = (tile: TileType) => {
    const idx = pool.indexOf(tile)
    if (idx < 0) throw new Error(`Missing tile ${tile} from pool`)
    return pool.splice(idx, 1)[0]
  }

  const flipTile = take('green') // 翻出绿发 → 钻牌为白板 ('white')
  const flipBottom = take('m9')

  const seat0Initial: TileType[] = [
    'm1', 'm2', 'm3',
    's1', 's2', 's3',
    'p1', 'p2', 'p3',
    'east', 'east', 'east',
    's7',
  ].map((t) => take(t as TileType))

  const draw0 = take(seat0DrawTile)
  const draws = seat1To3DrawTiles.map((t) => take(t))

  // 发牌顺序（dealer=3）：3 轮×4张 + 1轮×1张 + 庄家第14张 = 53 张
  const drawOrder: Array<TileType | null> = Array(134).fill(null)
  const dealTargets = [
    3, 3, 3, 3, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 0, 1, 2, 3,
  ]
  let s0Cursor = 0
  dealTargets.forEach((seat, idx) => {
    if (seat === 0) {
      drawOrder[idx] = seat0Initial[s0Cursor++]
    }
  })
  // 53: seat 0 首次摸牌；54..56: seat 1, 2, 3 各自摸牌
  drawOrder[53] = draw0
  drawOrder[54] = draws[0]
  drawOrder[55] = draws[1]
  drawOrder[56] = draws[2]

  // 其余槽位填充剩余安全牌（先交错排列不同花色/字牌，避免 AI 起手随机凑成胡牌）
  pool.sort((a, b) => a.localeCompare(b))
  const interleaved: TileType[] = []
  let lo = 0
  let hi = pool.length - 1
  while (lo <= hi) {
    if (lo <= hi) interleaved.push(pool[lo++])
    if (lo <= hi) interleaved.push(pool[hi--])
  }
  for (let i = 0; i < drawOrder.length; i += 1) {
    if (!drawOrder[i]) {
      const safeIdx = interleaved.findIndex((t) => t !== 'green' && t !== 'white')
      drawOrder[i] = interleaved.splice(safeIdx >= 0 ? safeIdx : 0, 1)[0]
    }
  }

  // 将 drawOrder 映射回 68 墩环状牌墙（openingStack=19，跳过 flipStack=15）
  const ring: TileType[] = Array(136).fill('m1')
  ring[15 * 2] = flipTile
  ring[15 * 2 + 1] = flipBottom
  let cursor = 0
  for (let step = 0; step < 68; step += 1) {
    const stack = (19 + step) % 68
    if (stack === 15) continue
    ring[stack * 2] = drawOrder[cursor++]!
    ring[stack * 2 + 1] = drawOrder[cursor++]!
  }
  return ring
}

describe('跑风整局实测演示', () => {
  it('玩家发动跑风 → 亮出对子放手牌前 → 下家起轮转一圈 → 回到本家跑风成功（双倍结算）', async () => {
    stubWindow()
    const trace: string[] = []
    const ring = buildPaofengRingWall('white', ['p9', 's9', 'm9'])
    const game = useLotusGame({ playSound: () => {}, playSoundAndWait: async () => {} })

    const startPromise = game.startGame('east', {
      dealer: 3,
      initialWall: ring,
      openingSecondDice: [1, 1],
    })

    // 推进到庄家(3)首弃、轮到本家(0)摸牌并出现「跑风」按钮
    for (let i = 0; i < 60; i += 1) {
      await vi.advanceTimersByTimeAsync(500)
      if (game.capabilities.value.paofeng?.available) break
    }
    expect(game.flipTile.value).toBe('green')
    expect(game.jokerTiles.value).toEqual(['white'])
    expect(game.capabilities.value.paofeng?.available).toBe(true)
    trace.push(`1. 翻钻=${game.flipTile.value}(钻=${game.jokerTiles.value.join(',')})，本家(0)摸牌后可跑风，手牌数=${game.players[0].hand.length}`)

    // 发动跑风
    game.capabilities.value.paofeng!.execute()
    await vi.advanceTimersByTimeAsync(100)
    expect(game.players[0].paofengPair).toEqual(['white', 's7'])
    expect(game.players[0].hand).toHaveLength(12)
    trace.push(`2. 本家发动跑风！亮出对子=${game.players[0].paofengPair?.join('+')}，剩余手牌=${game.players[0].hand.length}张，公告="${game.announcement.value?.text}"`)

    // 推进下家(1) → 对家(2) → 上家(3) 轮转一圈回到本家(0)
    const seenSeats = new Set<number>()
    for (let i = 0; i < 60; i += 1) {
      await vi.advanceTimersByTimeAsync(400)
      if (game.currentPlayer.value > 0) seenSeats.add(game.currentPlayer.value)
      if (game.phase.value === 'settled') break
    }
    await startPromise

    expect([...seenSeats].sort()).toEqual([1, 2, 3])
    expect(game.phase.value).toBe('settled')
    expect(game.result.value?.winnerIndex).toBe(0)
    expect(game.result.value?.winType).toBe('paofeng')
    expect(game.result.value?.paofengSuccess).toBe(true)
    expect(game.result.value?.details?.some((d) => d.label === '跑风成功' && d.multiplier === 2)).toBe(true)
    expect(resolveRoundResultPresentation(game.result.value)).toEqual({
      kind: 'paofeng',
      label: '跑风成功',
      strength: 'climax',
    })

    // 点击继续进入下一局，确认局数推进且 paofengPair 已清空
    game.nextRound({ dealer: 0, openingSecondDice: [1, 1] })
    await vi.advanceTimersByTimeAsync(100)
    expect(game.round.value).toBe(2)
    expect(game.players[0].paofengPair).toEqual([])
    trace.push(`3. 经过座位 [${[...seenSeats].join(' → ')}] 轮转一圈回到本家：${game.result.value?.winner} 跑风成功！番型=${game.result.value?.details?.map((d) => d.label).join('+')}, 总得分=+${game.result.value?.totalWon}, 四家分数=[${game.players.map((p) => p.score).join(', ')}]`)
    console.log('\n=== 跑风实测流程 ===\n' + trace.join('\n'))
  })
})
