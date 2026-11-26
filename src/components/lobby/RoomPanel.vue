<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LobbySeat } from '../../game/online/vibe/vibeLobby'
import { resolveAnimeCharacter, type CharacterId } from '../../game/llm/animeCharacters'
import { animeCharacterAvatarUrl } from '../../game/llm/animeCharacterPreference'
import type { TableThemeName } from '../table/three/tableTheme'

interface Props {
  roomId: string
  roomSeats: LobbySeat[]
  mySeat: number
  isHost: boolean
  sessionStatus: string
  allOccupiedReady: boolean
  matchStarting: boolean
  copied: boolean
  leaving: boolean
  closing: boolean
  ruleName: string
  /** 当前局域网访问地址（房主分享给同热点/Wi-Fi 朋友打开） */
  lanAddress?: string
  /** 当前牌桌主题（二次元主题下在房间内选本家形象） */
  tableThemeName: TableThemeName
  /** 本家当前选择的二次元角色 */
  characterId: CharacterId
}

const props = defineProps<Props>()
const currentCharacter = computed(() => resolveAnimeCharacter(props.characterId))
const currentCharacterAvatar = computed(() => animeCharacterAvatarUrl(props.characterId))
const emit = defineEmits<{
  copy: []
  toggleReady: []
  start: []
  leave: []
  close: []
  openCharacter: []
  'update:characterId': [value: CharacterId]
}>()

const addressCopied = ref(false)

async function copyLanAddress() {
  if (!props.lanAddress) return
  let ok = false
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(props.lanAddress)
      ok = true
    } catch { /* fallback below */ }
  }
  if (!ok) {
    let textarea: HTMLTextAreaElement | null = null
    try {
      textarea = document.createElement('textarea')
      textarea.value = props.lanAddress
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.top = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      ok = document.execCommand('copy')
    } catch {
      ok = false
    } finally {
      textarea?.remove()
    }
  }
  if (ok) {
    addressCopied.value = true
    window.setTimeout(() => { addressCopied.value = false }, 1600)
  }
}

function humanAt(seat: number): LobbySeat | undefined {
  return props.roomSeats.find((item) => item.seat === seat)
}
</script>

<template>
  <div class="room-panel">
    <div class="room-code" data-action-role="light" title="点击复制房间码" role="button" tabindex="0" @click="$emit('copy')" @keyup.enter="$emit('copy')">
      <span class="room-code-label">房间码</span><strong>{{ roomId }}</strong><span class="room-code-copied" :class="{ visible: copied }" :aria-hidden="!copied">已复制</span>
    </div>
    <div v-if="lanAddress" class="room-lan-address" title="点击复制局域网地址" role="button" tabindex="0" @click="copyLanAddress" @keyup.enter="copyLanAddress">
      <span>联机地址</span>
      <code>{{ lanAddress }}</code>
      <em>{{ addressCopied ? '已复制' : '复制' }}</em>
    </div>
    <div class="room-game-config"><b>{{ ruleName }}</b></div>
    <div class="room-seats">
      <div
        v-for="seatIndex in 4"
        :key="seatIndex - 1"
        class="room-seat"
        :class="{ occupied: !!humanAt(seatIndex - 1) }"
      >
        <span class="room-seat-no">{{ seatIndex }}</span>
        <template v-if="humanAt(seatIndex - 1)">
          <b>{{ humanAt(seatIndex - 1)?.nickname }}</b>
          <em v-if="humanAt(seatIndex - 1)?.ready">已准备</em>
          <em v-else class="unready">未准备</em>
        </template>
        <b v-else class="room-seat-empty">等待加入（空位 AI 补位）</b>
      </div>
    </div>
    <button
      v-if="tableThemeName === 'llmAnime'"
      class="room-character-entry"
      type="button"
      data-action-role="secondary"
      @click="$emit('openCharacter')"
    >
      <img :src="currentCharacterAvatar" alt="" aria-hidden="true">
      <span><small>本家形象</small><b>{{ currentCharacter.label }}</b></span>
      <em>更换 ›</em>
    </button>
    <div class="room-owner-actions">
      <button v-if="mySeat >= 0" class="secondary" :data-action-role="isHost && allOccupiedReady ? 'secondary' : 'primary'" :disabled="sessionStatus === 'readying'" @click="$emit('toggleReady')">准备 / 取消准备</button>
      <button
        v-if="isHost"
        class="start-button room-start"
        :data-action-role="!allOccupiedReady || matchStarting ? 'disabled' : 'primary'"
        :disabled="!allOccupiedReady || matchStarting"
        @click="$emit('start')"
      ><b>开始对局</b><span>{{ matchStarting ? '正在开局…' : (roomSeats.length < 2 ? '至少需要 2 名玩家' : (allOccupiedReady ? '全员已准备' : '等待全员准备')) }}</span></button>
    </div>
    <div class="room-actions-row">
      <button class="text-button room-leave" data-action-role="danger" :disabled="leaving || closing" @click="$emit('leave')">{{ leaving ? '离开中…' : '离开房间' }}</button>
      <button v-if="isHost" class="text-button room-close" data-action-role="danger" :disabled="leaving || closing" @click="$emit('close')">{{ closing ? '关闭中…' : '关闭房间' }}</button>
    </div>
  </div>
</template>

<style scoped>
.room-lan-address {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--theme-border);
  border-radius: 7px;
  background: color-mix(in srgb, var(--theme-panel-elevated) 75%, transparent);
  font-size: 12px;
  cursor: pointer;
}
.room-lan-address span {
  color: var(--theme-text-muted);
  white-space: nowrap;
}
.room-lan-address code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--theme-text);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.room-lan-address em {
  color: var(--theme-accent);
  font-style: normal;
  white-space: nowrap;
}
.room-seat-empty {
  color: var(--theme-text-muted);
  font-weight: 400;
  font-size: 12px;
}
.room-character-entry { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; padding: 6px 9px; border: 1px solid var(--theme-border); border-radius: 7px; background: var(--theme-panel-elevated); color: var(--theme-text); text-align: left; cursor: pointer; }
.room-character-entry img { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; }
.room-character-entry span { display: grid; min-width: 0; }
.room-character-entry small { color: var(--theme-text-muted); font-size: 9px; }
.room-character-entry b { font-size: 12px; }
.room-character-entry em { color: var(--theme-accent); font-size: 11px; font-style: normal; }
@media (hover: none) and (pointer: coarse) and (orientation: landscape) {
  .room-lan-address { padding: 4px 8px; font-size: 10px; }
  .room-character-entry { grid-template-columns: 26px minmax(0, 1fr) auto; padding: 3px 6px; }
  .room-character-entry img { width: 26px; height: 26px; }
}
</style>
