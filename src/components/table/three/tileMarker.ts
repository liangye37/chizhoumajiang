import type { TileType } from '../../../game/core/contracts/types'

export type TileMarker = 'joker' | 'wildcard' | false

/**
 * Resolve the displayed marker for a face-up tile.
 * - jokerTiles（钻牌，含白板被翻为钻牌时）→ 'joker'（钻）
 * - wildcardTiles（替身牌，如红中）→ 'wildcard'（替）
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
