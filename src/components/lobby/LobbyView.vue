<script setup lang="ts">
import { computed, ref } from 'vue'
import pkg from '../../../package.json'
import RoomPanel from './RoomPanel.vue'
import LobbyThemeVisual from './LobbyThemeVisual.vue'
import GameSettingsSummary from './GameSettingsSummary.vue'
import LobbyDialog from './LobbyDialog.vue'
import RuleVariantPicker from './RuleVariantPicker.vue'
import type { GameMode } from '../../game/core/contracts/activeGamePort'
import type { MatchType } from '../../game/core/contracts/types'
import { getRuleVariant, type RuleVariant } from '../../game/core/rules/ruleVariants'
import { getSelfHostConfig } from '../../game/online/transport/selfHost/selfHostConfig'
import type { LobbySeat } from '../../game/online/vibe/vibeLobby'
import AnimeCharacterPicker from '../llm/AnimeCharacterPicker.vue'
import type { CharacterId } from '../../game/llm/animeCharacters'
import type { TableThemeName } from '../table/three/tableTheme'

interface Props {
  gameMode: GameMode
  selectedMatch: MatchType
  selectedRule: RuleVariant
  roomId: string
  nicknameInput: string
  joinCode: string
  animeCharacterId: CharacterId
  tableThemeName: TableThemeName
  sessionStatus: string
  sessionError: string
  roomSeats: LobbySeat[]
  mySeat: number
  isHost: boolean
  allOccupiedReady: boolean
  matchStarting: boolean
  copied: boolean
  leaving: boolean
  closing: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:gameMode': [value: GameMode]
  'update:selectedMatch': [value: MatchType]
  'update:selectedRule': [value: RuleVariant]
  'update:nicknameInput': [value: string]
  'update:joinCode': [value: string]
  'update:animeCharacterId': [value: CharacterId]
  startLocal: []
  createRoom: []
  joinRoom: []
  copyRoom: []
  toggleReady: []
  startRemote: []
  leaveRoom: []
  closeRoom: []
  /** 打开本地对局回放列表（只存本机 IndexedDB）。 */
  openReplay: []
  openRules: []
}>()

type DialogName = 'join' | 'rule' | 'character' | null
const dialog = ref<DialogName>(null)

const appVersion = `v${pkg.version}`
const selfHostConfig = getSelfHostConfig()
const lanAvailable = Boolean(selfHostConfig) || import.meta.env.DEV
const lanAddress = selfHostConfig && typeof window !== 'undefined' ? window.location.origin : ''
const addressCopied = ref(false)

const ruleOption = computed(() => getRuleVariant(props.selectedRule))
const dialogTitle = computed(() => ({
  join: '加入局域网房间',
  rule: '规则玩法',
  character: '本家形象',
}[dialog.value ?? 'join']))

async function copyLanAddress() {
  if (!lanAddress) return
  let ok = false
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(lanAddress)
      ok = true
    } catch { /* fallback below */ }
  }
  if (!ok) {
    let textarea: HTMLTextAreaElement | null = null
    try {
      textarea = document.createElement('textarea')
      textarea.value = lanAddress
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

function selectRule(value: RuleVariant) {
  emit('update:selectedRule', value)
  dialog.value = null
}

function selectCharacter(value: CharacterId) {
  emit('update:animeCharacterId', value)
}

function confirmJoin() {
  dialog.value = null
  emit('joinRoom')
}

function viewRules() {
  dialog.value = null
  emit('openRules')
}
</script>

<template>
  <section class="lobby" :class="{ 'room-focused': Boolean(roomId) }">
    <div class="lobby-layout" :class="{ 'room-focused': Boolean(roomId) }">
      <LobbyThemeVisual :theme-name="tableThemeName" :character-id="animeCharacterId" @select-character="dialog = 'character'" />
      <section class="lobby-actions" aria-label="对局操作">
        <div class="mode-selector" role="radiogroup" aria-label="游戏模式">
          <button data-action-role="secondary" :class="{ active: gameMode === 'local' }" role="radio" :aria-checked="gameMode === 'local'" @click="$emit('update:gameMode', 'local')"><b>单机对战</b><span>与 AI 同桌</span></button>
          <button data-action-role="secondary" :class="{ active: gameMode === 'remote' }" role="radio" :aria-checked="gameMode === 'remote'" @click="$emit('update:gameMode', 'remote')"><b>局域网联机</b><span>同热点 / Wi-Fi 建房</span></button>
        </div>
        <template v-if="gameMode === 'local'">
          <GameSettingsSummary
            match-name=""
            match-description=""
            :rule-name="ruleOption.name"
            :rule-description="ruleOption.highlights.slice(0, 2).join(' · ')"
            @select-rule="dialog = 'rule'"
          />
          <button class="start-button" data-action-role="primary" @click="$emit('startLocal')"><b>开始对局</b><span>{{ ruleOption.name }} · 四人对局</span></button>
        </template>

        <div v-else class="remote-lobby">
          <div v-if="!lanAvailable" class="lan-unavailable-card">
            <strong>请先启动局域网服务</strong>
            <p>由房主在电脑打开桌面「池州麻将」启动服务，朋友连上同一热点或 Wi-Fi 后，用浏览器访问房主电脑显示的局域网地址即可建房同桌。</p>
          </div>
          <template v-else>
            <div v-if="!roomId && lanAddress" class="lan-address-bar" role="button" tabindex="0" title="点击复制局域网地址" @click="copyLanAddress" @keyup.enter="copyLanAddress">
              <span>本机地址</span>
              <code>{{ lanAddress }}</code>
              <em>{{ addressCopied ? '已复制' : '复制' }}</em>
            </div>
            <label v-if="!roomId" class="remote-field">
              <span>昵称</span>
              <input
                :value="nicknameInput"
                maxlength="12"
                placeholder="输入昵称"
                @input="$emit('update:nicknameInput', ($event.target as HTMLInputElement).value)"
                @keyup.enter="nicknameInput.trim() && $emit('createRoom')"
              />
            </label>
            <div v-if="!roomId" class="remote-entry-actions">
              <button class="remote-create" data-action-role="primary" :disabled="!nicknameInput.trim() || sessionStatus === 'creating'" @click="$emit('createRoom')">
                {{ sessionStatus === 'creating' ? '创建中…' : '创建房间' }}
              </button>
              <button class="remote-join-btn" data-action-role="primary" :disabled="!nicknameInput.trim() || sessionStatus === 'joining'" @click="dialog = 'join'">
                {{ sessionStatus === 'joining' ? '加入中…' : '加入房间' }}
              </button>
            </div>
            <p v-if="sessionError" class="session-error" role="alert">{{ sessionError }}</p>

            <RoomPanel
              v-if="roomId"
              :room-id="roomId"
              :room-seats="roomSeats"
              :my-seat="mySeat"
              :is-host="isHost"
              :session-status="sessionStatus"
              :all-occupied-ready="allOccupiedReady"
              :match-starting="matchStarting"
              :copied="copied"
              :leaving="leaving"
              :closing="closing"
              :rule-name="ruleOption.name"
              :lan-address="lanAddress"
              :table-theme-name="tableThemeName"
              :character-id="animeCharacterId"
              @copy="$emit('copyRoom')"
              @toggle-ready="$emit('toggleReady')"
              @start="$emit('startRemote')"
              @leave="$emit('leaveRoom')"
              @close="$emit('closeRoom')"
              @open-character="dialog = 'character'"
              @update:character-id="$emit('update:animeCharacterId', $event)"
            />
          </template>
        </div>

        <div class="lobby-links">
          <button class="text-button" data-action-role="light" data-testid="open-replay" @click="$emit('openReplay')">对局回放 →</button>
          <button class="text-button" data-action-role="light" @click="$emit('openRules')">游戏规则 →</button>
          <a class="repository-link" data-action-role="light" href="https://github.com/liangye37/chizhoumajiang" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 新标签页打开池州麻将仓库">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.24c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A11 11 0 0 1 12 6.1c.98 0 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>
            GitHub ↗
          </a>
        </div>
      </section>
    </div>

    <LobbyDialog v-if="dialog" :title="dialogTitle" :wide="dialog === 'rule' || dialog === 'character'" :theme-name="tableThemeName" :variant="dialog" @close="dialog = null">
      <template v-if="dialog === 'join'">
        <label class="join-dialog-field">
          <span>房间码</span>
          <input
            :value="joinCode"
            maxlength="6"
            autofocus
            placeholder="输入 6 位房间码"
            @input="$emit('update:joinCode', ($event.target as HTMLInputElement).value.toUpperCase())"
            @keyup.enter="joinCode.trim() && confirmJoin()"
          />
        </label>
        <p class="dialog-hint">输入房主屏幕上的 6 位房间码即可加入同桌。</p>
        <div class="dialog-actions">
          <button class="secondary" type="button" data-action-role="light" @click="dialog = null">取消</button>
          <button class="primary" type="button" data-action-role="primary" :disabled="!joinCode.trim() || sessionStatus === 'joining'" @click="confirmJoin">确认加入</button>
        </div>
      </template>

      <AnimeCharacterPicker
        v-else-if="dialog === 'character'"
        :model-value="animeCharacterId"
        @update:model-value="selectCharacter"
      />

      <RuleVariantPicker v-else :model-value="selectedRule" @close="dialog = null" @confirm="selectRule" @view-rules="viewRules" />
    </LobbyDialog>

    <span class="lobby-version" :class="{ 'beside-fab': gameMode === 'local' }" aria-label="当前版本号">{{ appVersion }}</span>
  </section>
</template>

<style scoped>
.lobby-actions { min-width: 0; }
.lan-unavailable-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--theme-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--theme-panel-elevated) 80%, transparent);
}
.lan-unavailable-card strong {
  color: var(--theme-text);
  font-size: 14px;
}
.lan-unavailable-card p {
  margin: 0;
  color: var(--theme-text-muted);
  font-size: 13px;
  line-height: 1.6;
}
.lan-address-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--theme-panel-elevated) 75%, transparent);
  font-size: 12px;
  cursor: pointer;
}
.lan-address-bar span {
  color: var(--theme-text-muted);
  white-space: nowrap;
}
.lan-address-bar code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--theme-text);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.lan-address-bar em {
  color: var(--theme-accent);
  font-style: normal;
  white-space: nowrap;
}
.lobby-version {
  position: fixed;
  z-index: 65;
  right: max(16px, var(--safe-right));
  bottom: max(14px, var(--safe-bottom));
  padding: 3px 9px;
  border: 1px solid color-mix(in srgb, var(--theme-border) 55%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--theme-panel) 78%, transparent);
  color: var(--theme-text-muted);
  font: 600 12px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .04em;
  pointer-events: none;
  user-select: none;
}
.lobby-version.beside-fab {
  right: max(68px, calc(var(--safe-right) + 56px));
  bottom: max(22px, calc(var(--safe-bottom) + 12px));
}
@media (hover: none) and (pointer: coarse) and (orientation: landscape) {
  .lobby-version,
  .lobby-version.beside-fab {
    right: max(12px, var(--safe-right));
    bottom: max(8px, var(--safe-bottom));
    font-size: 11px;
  }
}
</style>
