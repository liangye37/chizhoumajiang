import { createTileFlowExecutor } from '../../shared/runtime/tileFlowExecutor'
import type { LotusController } from './lotusControllers'
import type { LotusGameState } from './lotusState'
import type { createLotusTurnOrchestrator } from './lotusTurnOrchestrator'
import { sortTilesWithJokers } from '../../core/rules/tiles'
import { DEAD_WALL_TILES, takeLotusTailTile } from './lotusWall'
import { isSpecialTile } from './lotusRules'
import type { FollowDealerTracker } from '../../shared/runtime/followDealer'
import type { GamePlayer, TileType } from '../../core/contracts/types'

interface LotusTileFlowOptions {
  state: LotusGameState
  controllers: LotusController[]
  getTurnOrchestrator(): ReturnType<typeof createLotusTurnOrchestrator>
  endDraw(): unknown
  playSound(name: string, volume?: number): unknown
  playSoundAndWait?: (name: string, volume?: number) => Promise<void>
  shouldAnnounceDiscard?: (playerIndex: number, player: GamePlayer) => boolean
  later(callback: () => void, delay: number): number
  stopCountdown(): void
  followDealer?: FollowDealerTracker
  handleSpecialDraw?: (
    playerIndex: number,
    tile: TileType,
    drawAgain: () => Promise<boolean>,
  ) => Promise<boolean | undefined>
  useGreenDiscard?: (playerIndex: number, tile: TileType) => Promise<boolean>
}

export function createLotusTileFlow(options: LotusTileFlowOptions) {
  return createTileFlowExecutor({
    ...options,
    sortHand: (hand) => sortTilesWithJokers(hand, options.state.jokerTiles.value),
    getTurnFlow: options.getTurnOrchestrator,
    minRemainingTiles: DEAD_WALL_TILES,
    takeTailTile: takeLotusTailTile,
    discardInterceptor: async (playerIndex, tile) => {
      if (isSpecialTile(tile, options.state.jokerTiles.value) && !options.state.jokerTiles.value.includes(tile)) {
        return Boolean(await options.useGreenDiscard?.(playerIndex, tile))
      }
      return false
    },
  })
}
