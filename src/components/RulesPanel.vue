<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { BASE_SCORE } from '../game/core/rules/rules'
import { DISCLAIMER_SECTIONS, DISCLAIMER_TITLE } from '../content/disclaimer'
import { congyangRules, gameRules } from '../content/gameRules'
import { DEFAULT_RULE_VARIANT, type RuleVariant } from '../game/core/rules/ruleVariants'
import TableControlIcon from './table/TableControlIcon.vue'

const props = defineProps<{ open: boolean; variant?: RuleVariant }>()
defineEmits(['close'])

const fullRulesDialog = ref<HTMLDialogElement | null>(null)
const fullRulesOpen = ref(false)
const fullRulesId = useId()
const chapters = computed(() => gameRules[props.variant ?? DEFAULT_RULE_VARIANT] ?? congyangRules)

function openFullRules() {
  const dialog = fullRulesDialog.value
  if (!dialog || dialog.open) return
  dialog.showModal()
  fullRulesOpen.value = true
}

watch(() => props.open, (open) => {
  if (!open) fullRulesOpen.value = false
})

const legacyPaymentExamples = [
  { title: '庄家吃胡闲家', winner: '庄家',
    payments: [{ payer: '点炮闲家', amount: 400 }, { payer: '其余两位闲家', amount: 200, each: true }], total: 800 },
  { title: '庄家自摸', winner: '庄家',
    payments: [{ payer: '三位闲家', amount: 400, each: true }], total: 1200 },
  { title: '庄家抢杠胡', winner: '庄家',
    payments: [{ payer: '三位闲家（含被抢杠者）', amount: 400, each: true }], total: 1200,
    note: '按自摸型收付，被抢杠者不再单独双付。' },
  { title: '闲家吃胡闲家', winner: '胡牌闲家',
    payments: [{ payer: '庄家', amount: 200 }, { payer: '点炮闲家', amount: 200 }, { payer: '另一位闲家', amount: 100 }], total: 500 },
  { title: '闲家吃胡庄家', winner: '胡牌闲家',
    payments: [{ payer: '点炮庄家', amount: 400 }, { payer: '其余两位闲家', amount: 100, each: true }], total: 600 },
  { title: '闲家自摸', winner: '胡牌闲家',
    payments: [{ payer: '庄家', amount: 400 }, { payer: '其余两位闲家', amount: 200, each: true }], total: 800 },
  { title: '闲家抢杠胡', winner: '胡牌闲家',
    payments: [{ payer: '庄家', amount: 400 }, { payer: '其余两位闲家', amount: 200, each: true }], total: 800,
    note: '抢庄家或闲家的补杠，均按此表支付；被抢杠者不再单独双付。' },
  { title: '特殊天地胡（不计庄家）', winner: '胡家',
    payments: [{ payer: '另外三家（不分庄闲）', amount: 1000, each: true }], total: 3000,
    note: '天胡：三位闲家付给庄家；地胡：庄家和另外两位闲家付给胡牌闲家。固定10番，不叠加平胡、自摸、庄家或点炮者翻倍。' },
]

const rules = computed(() => {
  return [
    ['多端兼容', '电脑端：鼠标单击出牌、移动端：手机双击出牌或上滑出牌'],
    ['翻钻癞子', '骰子翻出指示牌，其同序下一张为钻牌（万能牌），可代替任意牌完成对子、刻子或顺子。'],
    ['只碰不吃', '可以碰牌、明杠、暗杠与补杠，不能吃牌；东南西北风不可成顺也不可风杠放倒。操作优先级：胡 > 杠 > 碰 > 过。'],
    ['红中替代', '红中是本局替代牌（非真钻时），可当作本局钻牌面参与成牌。'],
    ['发财摸尾', '发财（非钻牌时）摸到或打出后直接放置在手牌旁边，并从牌墙另一端（与正常摸牌方向相反）补摸一张。'],
    ['胡牌牌型', '平胡、七对子、十三烂、七星十三烂、十三幺等特殊牌型按完整副露与胡牌张重新判型。'],
    ['胡牌来源', '仅支持自摸胡与抢杠胡，不支持点炮胡；听任意（单吊钻牌）时只能自摸，不可抢杠胡。'],
    ['面子规则', '钻牌可补缺张、做将；红中按替代牌参与判定；发财作为钻牌时可按普通牌面/钻牌参与；东南西北风仅可作刻子或将牌。'],
    ['跑风规则', '完成 3+3+3+3+2 标准牌型且将牌对子含真钻牌（红中非钻时不计）时，可将对子亮出放手牌前发动跑风并轮转一圈。轮转中他家可碰杠但跑风者不可；轮回跑风者则成功（暂双倍）；期间他家自摸/抢杠为「捉」，跑风者包赔三倍给捉胡者；摸空流局按正常流局。'],
    ['收付方式', '每次胡牌，另外三家都分别向胡家付款；普通吃胡时，点炮者把自己那一笔再付双倍。自摸、抢杠不对某一付款者单独双付。'],
    ['起始分数', '每位玩家起始 2000 分，基础结算单位 100。'],
  ]
})

const panelTitle = computed(() => '枞阳有钻麻将玩法')
const baseNote = computed(() => `基础分 ${BASE_SCORE} 分 · 番数×底分，按身份收付`)
</script>

<template>
  <Transition name="panel">
    <aside v-if="open" class="rules-panel">
      <header>
        <div>
          <h2>{{ panelTitle }}</h2>
        </div>
        <button type="button" aria-label="关闭规则" @click="$emit('close')">×</button>
      </header>
      <button type="button" class="rules-source-trigger" aria-haspopup="dialog" :aria-controls="fullRulesId" @click="openFullRules">
        查看完整规则
      </button>
      <div class="rule-list">
        <article v-for="(rule, index) in rules" :key="rule[0]">
          <b>{{ String(index + 1).padStart(2, '0') }}</b>
          <div>
            <h3>{{ rule[0] }}</h3><p>{{ rule[1] }}</p>
            <section v-if="rule[0] === '收付方式'" class="legacy-payment-examples" aria-label="平胡分数流向">
              <p class="legacy-payment-intro">以下以平胡1番、底分100分为例，只列胡牌收付，杠分另算。其他普通牌型按基础番数同比增加；天地胡按第8例平收。</p>
              <ol>
                <li v-for="example in legacyPaymentExamples" :key="example.title">
                  <h4>{{ example.title }}</h4>
                  <p v-for="payment in example.payments" :key="payment.payer" class="legacy-payment-flow">
                    {{ payment.payer }} → {{ example.winner }}：<strong>{{ payment.each ? '各' : '' }}{{ payment.amount }}分</strong>
                  </p>
                  <p class="legacy-payment-total">{{ example.winner }}合计收入：+{{ example.total }}分</p>
                  <p v-if="example.note" class="legacy-payment-note">{{ example.note }}</p>
                </li>
              </ol>
            </section>
          </div>
        </article>
      </div>
      <div class="rule-note">{{ baseNote }}</div>
      <section class="disclaimer-block" aria-label="用户声明">
        <h3>{{ DISCLAIMER_TITLE }}</h3>
        <template v-for="(section, index) in DISCLAIMER_SECTIONS" :key="index">
          <h4 v-if="section.title">{{ section.title }}</h4>
          <p v-if="section.body">{{ section.body }}</p>
          <ol v-if="section.list?.length">
            <li v-for="(item, itemIndex) in section.list" :key="itemIndex">{{ item }}</li>
          </ol>
        </template>
      </section>
    </aside>
  </Transition>

  <dialog v-if="open" :id="fullRulesId" ref="fullRulesDialog" class="rules-source-dialog"
    :aria-labelledby="`${fullRulesId}-title`" @close="fullRulesOpen = false" @click.self="fullRulesDialog?.close()">
    <header class="rules-source-header">
      <h2 :id="`${fullRulesId}-title`">{{ panelTitle }} · 完整规则</h2>
      <button type="button" aria-label="关闭完整规则" autofocus @click="fullRulesDialog?.close()">
        <TableControlIcon name="close" />
      </button>
    </header>
    <div v-if="fullRulesOpen" class="rules-source-scroll" role="region" aria-label="规则正文" tabindex="0">
      <section v-for="chapter in chapters" :key="chapter.title">
        <h3>{{ chapter.title }}</h3>
        <p v-for="paragraph in chapter.paragraphs" :key="paragraph">{{ paragraph }}</p>
        <div v-if="chapter.table" class="rules-source-table">
          <table :aria-label="chapter.title">
            <thead><tr><th v-for="heading in chapter.table.headings" :key="heading" scope="col">{{ heading }}</th></tr></thead>
            <tbody>
              <tr v-for="row in chapter.table.rows" :key="row[0]">
                <td v-for="(cell, index) in row" :key="index">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </dialog>
</template>

<style scoped>
.rules-source-trigger {
  width: 100%;
  min-height: var(--control-hit-target);
  margin-bottom: 14px;
  padding: 7px 12px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-panel);
  color: var(--theme-accent-text);
  text-align: left;
  font-weight: 700;
  cursor: pointer;
}
.rules-source-trigger:hover { background: var(--theme-panel-elevated); }
.rules-source-dialog {
  position: fixed;
  inset: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
  width: min(880px, calc(100vw - var(--safe-left) - var(--safe-right) - 24px));
  height: min(760px, calc(100dvh - var(--safe-top) - var(--safe-bottom) - 24px));
  max-width: none;
  max-height: none;
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--theme-border);
  border-radius: 14px;
  background: var(--theme-panel);
  color: var(--theme-text);
  box-shadow: 0 18px 60px #0009;
}
.rules-source-dialog[open] { display: flex; flex-direction: column; }
.rules-source-dialog::backdrop { background: #000a; }
.rules-source-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 12px 5px 18px;
  border-bottom: 1px solid var(--theme-border);
  background: var(--theme-panel-elevated);
}
.rules-source-header h2 { margin: 0; font-size: 17px; line-height: 1.3; }
.rules-source-header button {
  display: grid;
  place-items: center;
  flex: none;
  width: var(--control-hit-target);
  height: var(--control-hit-target);
  padding: 0;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-panel);
  color: var(--theme-text);
  cursor: pointer;
}
.rules-source-dialog :focus-visible { outline: 2px solid var(--theme-accent); outline-offset: -2px; }
.rules-source-scroll {
  flex: 1;
  min-height: 0;
  padding: clamp(14px, 3vw, 28px);
  overflow: auto;
  overscroll-behavior: contain;
  font-size: 15px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
  scrollbar-color: var(--theme-accent) color-mix(in srgb, var(--theme-panel) 82%, transparent);
}
.rules-source-scroll::-webkit-scrollbar { width: 7px; }
.rules-source-scroll::-webkit-scrollbar-track { background: color-mix(in srgb, var(--theme-panel) 82%, transparent); border-radius: 8px; }
.rules-source-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--theme-accent) 72%, var(--theme-panel)); border-radius: 8px; }
.rules-source-scroll section + section { margin-top: 24px; }
.rules-source-scroll h3 {
  margin: 0 0 .6em;
  padding-bottom: .25em;
  border-bottom: 1px solid var(--theme-border);
  color: var(--theme-accent-text);
  font-size: 1.25em;
}
.rules-source-scroll p { margin: .65em 0; }
.rules-source-table { margin-top: 12px; overflow-x: auto; }
.rules-source-table table { width: 100%; border-collapse: collapse; font-size: .94em; }
.rules-source-table :is(th, td) {
  min-width: 4em;
  padding: .45em .6em;
  border: 1px solid color-mix(in srgb, var(--theme-border) 55%, transparent);
  text-align: left;
  vertical-align: top;
}
.rules-source-table th { background: var(--theme-panel-elevated); }

.legacy-payment-examples { margin-top: 12px; }
.legacy-payment-examples .legacy-payment-intro { font-size: 12px; }
.legacy-payment-examples ol { margin: 12px 0 0; padding-left: 20px; }
.legacy-payment-examples li { padding: 10px 0; border-top: 1px solid var(--theme-border, rgba(255,255,255,.12)); }
.legacy-payment-examples li::marker { color: var(--theme-accent-text, #b18c48); font-weight: 700; }
.legacy-payment-examples h4 { margin: 0 0 6px; color: var(--theme-text, #f0dfba); font-size: 13px; }
.legacy-payment-examples .legacy-payment-flow { overflow-wrap: anywhere; font-size: 12px; }
.legacy-payment-flow strong { color: var(--theme-text, #f0dfba); white-space: nowrap; }
.legacy-payment-examples .legacy-payment-total { margin-top: 5px; color: var(--theme-accent-text, #c2aa73); font-weight: 700; font-size: 12px; }
.legacy-payment-examples .legacy-payment-note { margin-top: 4px; font-size: 11px; }
</style>
