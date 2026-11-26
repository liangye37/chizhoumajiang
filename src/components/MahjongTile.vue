<script setup lang="ts">
import { computed } from 'vue'
import { TILE_META } from '../game/core/rules/tiles'
import { tileBackUrl, tileFaceUrl, type TileAssetTheme } from '../game/core/presentation/tileAssets'
import type { TileType } from '../game/core/contracts/types'

const props = withDefaults(defineProps<{
  tile?: TileType | 'back'
  hidden?: boolean
  selected?: boolean
  drawn?: boolean
  disabled?: boolean
  small?: boolean
  themeName?: TileAssetTheme
  /** 本局癞子集合；未传时按现行玩法「白板」高亮 */
  jokerTiles?: TileType[]
  /** 可替代精牌的实体牌；不参与精牌排序。 */
  wildcardTiles?: TileType[]
  /** 开启听牌提示时，将非真钻的红中直接替换为本局钻牌牌面并标「中」。 */
  replaceRedWithJoker?: boolean
}>(), { tile: 'back', hidden: false, selected: false, drawn: false, disabled: false, small: false, replaceRedWithJoker: false })

const emit = defineEmits(['choose'])
const choose = (event?: Event) => {
  if (!props.disabled) emit('choose', event)
}
const isRedSubstituted = computed(() => (
  Boolean(
    props.replaceRedWithJoker
    && props.tile === 'red'
    && props.jokerTiles?.length
    && !props.jokerTiles.includes('red'),
  )
))
const shownTile = computed(() => (
  props.hidden
    ? 'back'
    : isRedSubstituted.value
      ? props.jokerTiles![0]
      : props.tile
))
const meta = computed(() => TILE_META[shownTile.value] || TILE_META.back)
const isPrecision = computed(() => (
  props.tile !== 'back'
  && props.tile !== 'white'
  && Boolean(props.jokerTiles?.includes(props.tile))
))
// 白板翻精：白板本身是精（jokerTiles 与 wildcardTiles 都含白板，可替代任意牌）→ 标「精」，
// 优先于替身判定（此前落入 isWildcard，白板翻精被误标为「替」）。
const isWhiteJoker = computed(() => (
  props.tile === 'white'
  && Boolean(props.jokerTiles?.includes(props.tile))
  && Boolean(props.wildcardTiles?.includes(props.tile))
))
// 替牌 = 莲花麻将中可替代精牌的实体牌（白板出现在 wildcardTiles 且非精）；
// 莲花广麻无 wildcardTiles，白板癞子走 isLaizi，不在此列。
const isWildcard = computed(() => {
  if (props.tile === 'back' || isPrecision.value || isWhiteJoker.value) return false
  return Boolean(props.wildcardTiles?.includes(props.tile))
})
const isLaizi = computed(() => (
  !isPrecision.value
  && !isWhiteJoker.value
  && !isWildcard.value
  && props.tile === 'white'
  && Boolean(props.jokerTiles?.includes(props.tile))
))
const isJoker = computed(() => isPrecision.value || isWhiteJoker.value || isWildcard.value || isLaizi.value || isRedSubstituted.value)
// 标记按身份区分：真钻牌标「钻」，听牌提示替换的红中标「中」，其余替身标「替」，白板癞子标「癞」。
const tileMarker = computed(() => (
  isPrecision.value || isWhiteJoker.value
    ? '钻'
    : isRedSubstituted.value
      ? '中'
      : isWildcard.value
        ? '替'
        : isLaizi.value
          ? '癞'
          : ''
))
const tileLabel = computed(() => {
  if (!isJoker.value || shownTile.value === 'back') return meta.value.name
  if (isRedSubstituted.value) return `红中（替${meta.value.name}）`
  const role = isPrecision.value || isWhiteJoker.value ? '钻牌' : isLaizi.value ? '癞子' : '万能牌'
  return `${meta.value.name}，${role}${isWildcard.value ? '，可代本局钻牌' : ''}`
})
const tileStyle = computed(() => {
  if (shownTile.value === 'back') {
    return { '--tile-back-image': `url("${tileBackUrl(props.themeName)}")` }
  }
  // 优先用预加载的内存 blob URL；预加载未完成时回退网络地址（浏览器缓存兜底）
  return { backgroundImage: `url("${tileFaceUrl(shownTile.value as TileType, props.themeName)}")` }
})
</script>

<template>
  <div
    class="mahjong-tile"
    :class="{ selected, drawn, disabled, small, 'tile-back': shownTile === 'back', joker: (isPrecision || isWhiteJoker) && !hidden, wildcard: (isWildcard || isRedSubstituted) && !hidden, laizi: isLaizi && !hidden, red: tile === 'red' && !isRedSubstituted && !hidden }"
    :style="tileStyle"
    role="button"
    :aria-label="tileLabel"
    :aria-disabled="disabled"
    :tabindex="disabled ? -1 : 0"
    @click="choose"
    @keydown.enter="choose"
    @keydown.space.prevent="choose"
  >
    <span v-if="isJoker && !hidden" class="joker-mark">{{ tileMarker }}</span>
  </div>
</template>
