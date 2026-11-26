import { describe, expect, it } from 'vitest'
import type { TileType } from '../../core/contracts/types'
import { computeJokers } from './lotusRules'
import {
  buildDrawOrderWall,
  buildLotusWall,
  buildRingWall,
  removeFlipStack,
  resolveFlip,
  resolveOpeningFromDice,
  resolveOpeningStack,
  seatSegmentStart,
  takeLotusTailTile,
  wallBreakIndexForOpeningStack,
} from './lotusWall'

describe('莲花麻将开局分步构造（立牌山 → 翻精 → 开门）', () => {
  it('立起的牌山为 136 张环序', () => {
    const ring = buildRingWall(() => 0)
    expect(ring).toHaveLength(136)
  })
  it('移出翻精墩后剩 134 张', () => {
    const ring = buildRingWall(() => 0)
    const { flipSeat, flipStack } = resolveFlip(ring, 0, [1, 1])
    expect(flipSeat).toBe(1)
    expect(flipStack).toBe(66)
    const wall = removeFlipStack(ring, flipStack)
    expect(wall).toHaveLength(134)
  })
  it('分步结果与一次性 buildLotusWall 一致', () => {
    const ring = buildRingWall(() => 0)
    const { flipStack, flipTile, jokers } = resolveFlip(ring, 1, [4, 4])
    const openingStack = resolveOpeningFromDice(1, [4, 4])
    const wall = buildDrawOrderWall(ring, openingStack, flipStack)
    const combined = buildLotusWall({ dealer: 1, dice: [2, 3], secondDice: [4, 4], random: () => 0 })
    expect(wall).toEqual(combined.wall)
    expect(flipTile).toBe(combined.flipTile)
    expect(jokers).toEqual(combined.jokers)
    expect(openingStack).toBe(combined.openingStack)
    expect(wallBreakIndexForOpeningStack(openingStack, flipStack)).toBe(combined.wallBreakIndex)
  })

  it('第二次骰子从翻精墩向后数 T+1 墩，而不是 T 墩', () => {
    expect(resolveOpeningStack(10, [1, 1])).toBe(13)
    expect(resolveOpeningStack(66, [6, 6])).toBe(11)
  })
  it('杠后从当前尾墙先补摸顶层，再摸同墩底层', () => {
    const ring = Array.from({ length: 136 }, (_, index) => `m${index}` as TileType)
    const wall = buildDrawOrderWall(ring, 0, 10)
    expect(takeLotusTailTile(wall, 0)).toBe(ring[67 * 2])
    expect(takeLotusTailTile(wall, 0)).toBe(ring[67 * 2 + 1])
    expect(takeLotusTailTile(wall, 0)).toBe(ring[66 * 2])
    expect(takeLotusTailTile(wall, 0)).toBe(ring[66 * 2 + 1])
  })
  it('不保留王牌，牌头与杠尾合计可摸完全部 134 张', () => {
    const ring = Array.from({ length: 136 }, (_, index) => `m${index}` as TileType)
    const wall = buildDrawOrderWall(ring, 0, 10)
    let headDrawn = 0
    expect(takeLotusTailTile(wall, headDrawn)).not.toBeNull()
    while (wall.length) {
      wall.shift()
      headDrawn += 1
    }
    expect(headDrawn + 1).toBe(134)
    expect(takeLotusTailTile(wall, headDrawn)).toBeNull()
  })
})

describe('莲花麻将牌墙构造', () => {
  it('座位段起始墩', () => {
    expect(seatSegmentStart(0)).toBe(0)
    expect(seatSegmentStart(1)).toBe(51)
    expect(seatSegmentStart(2)).toBe(34)
    expect(seatSegmentStart(3)).toBe(17)
  })

  it('二次骰子小点数从下家左起跳过 M 墩翻下一墩，点数和从投骰者右起保留 T 墩开门', () => {
    // dealer=0, secondDice=[4,5]: M=4 → 下家(seat 1, 51..67)左起跳过4墩翻下一墩 = 51+(16-4) = 63
    // T=9 → seat 0(0..16)右起保留9墩，从 stack 9 开门，wallBreakIndex = 18
    const result = buildLotusWall({ dealer: 0, dice: [2, 3], secondDice: [4, 5], random: () => 0 })
    expect(result.flipStack).toBe(63)
    expect(result.openingStack).toBe(9)
    expect(result.wallBreakIndex).toBe(18)
  })

  it('翻钻按投骰者下家定位（dealer=2 时下家为 seat 3）', () => {
    // dealer=2, secondDice=[1,6]: M=1 → 下家(seat 3, 17..33)左起跳过1墩翻下一墩 = 17+(16-1) = 32
    // T=7 → seat 2(34..50)右起保留7墩，从 stack 34+7 = 41 开门
    const result = buildLotusWall({ dealer: 2, dice: [5, 5], secondDice: [1, 6], random: () => 0 })
    expect(result.flipStack).toBe(32)
    expect(result.openingStack).toBe(41)
  })

  it('同序下一张 = 钻牌（枞阳单钻规则）', () => {
    const result = buildLotusWall({ dealer: 0, dice: [1, 1], secondDice: [1, 1], random: () => 0 })
    expect(result.jokers).toEqual(computeJokers(result.flipTile))
    // 白板翻钻：钻牌 = 红中。
    expect(computeJokers('white')).toEqual(['red'])
  })

  it('翻精墩整体跳过，牌墙 134 张且每种不超过 4 张', () => {
    const result = buildLotusWall({ dealer: 0, dice: [1, 1], secondDice: [1, 1], random: () => 0 })
    expect(result.wall).toHaveLength(134)
    const counts = new Map<string, number>()
    result.wall.forEach((tile) => counts.set(tile, (counts.get(tile) || 0) + 1))
    counts.forEach((count) => expect(count).toBeLessThanOrEqual(4))
  })

  it('开门墩为牌墙头：wall[0] 为该墩顶层', () => {
    const result = buildLotusWall({ dealer: 0, dice: [1, 1], secondDice: [1, 1], random: () => 0 })
    expect(result.flipStack).toBe(66)
    expect(result.openingStack).toBe(2)
    // wall[0]/wall[1] 是开门墩（2）的顶层/底层
    expect(result.wallBreakIndex).toBe(4)
    expect(result.wall).toHaveLength(134)
  })

  it('发牌顺序从开门墩顺时针展开，并整墩跳过翻精墩', () => {
    const ring = Array.from({ length: 136 }, (_, index) => `m${index}` as TileType)
    const wall = buildDrawOrderWall(ring, 66, 1)

    expect(wall.slice(0, 8)).toEqual([
      ring[66 * 2], ring[66 * 2 + 1],
      ring[67 * 2], ring[67 * 2 + 1],
      ring[0], ring[1],
      ring[2 * 2], ring[2 * 2 + 1],
    ])
    expect(wall).not.toContain(ring[2])
    expect(wall).not.toContain(ring[3])
    expect(wall).toHaveLength(134)
  })

  it('3D 断点指向开门墩的物理上层张位，并按 136 张环回', () => {
    expect(wallBreakIndexForOpeningStack(0)).toBe(0)
    expect(wallBreakIndexForOpeningStack(55)).toBe(110)
    expect(wallBreakIndexForOpeningStack(68)).toBe(0)
    expect(wallBreakIndexForOpeningStack(-1)).toBe(134)
    expect(wallBreakIndexForOpeningStack(52, 52)).toBe(106)
  })
})
