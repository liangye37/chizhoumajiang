import type { TileType } from '../../../game/core/contracts/types'

export type TileMarker = 'joker' | 'wildcard' | 'laizi' | false

/**
 * Resolve the displayed marker for a face-up tile.
 * 按白板身份区分标记：
 * - 白板翻精（jokerTiles 与 wildcardTiles 都含白板）：白板本身是精 → 'joker'（精）
 * - 莲花麻将替身（仅 wildcardTiles 含白板）：可代本局精牌 → 'wildcard'（替）
 * - 莲花广麻白板癞子（仅 jokerTiles 含白板）：万能牌 → 'laizi'（癞）
 */
export function tileMarkerFor(
  tile: TileType,
  jokerTiles: readonly TileType[] = [],
  wildcardTiles: readonly TileType[] = [],
): TileMarker {
  if (jokerTiles.includes(tile)) return 'joker'
  if (wildcardTiles.includes(tile)) return 'wildcard'
  return false
}
