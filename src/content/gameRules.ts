import { BASE_SCORE } from '../game/core/rules/rules'
import type { RuleVariant } from '../game/core/rules/ruleVariants'

interface RuleChapter {
  title: string
  paragraphs?: readonly string[]
  table?: { headings: readonly string[]; rows: ReadonlyArray<readonly (string | number)[]> }
}

const fourSeats = '四人使用 136 张牌，万、筒、索各 1～9，东、南、西、北、中、发、白各四张。庄家起手 14 张先打，闲家各 13 张。'
const matchLength = '庄家胡牌或流局时庄家听牌则连庄，否则轮到下家坐庄。'
const dealerFollow = `第一圈三位闲家的第一张弃牌均与庄家首弃相同，庄家向三家各付 ${BASE_SCORE} 分。第一圈被碰、杠或胡打断时，跟庄窗口结束。`
const controls: RuleChapter = {
  title: '出牌与听牌提示',
  paragraphs: ['电脑单击手牌出牌，手机可双击或上滑出牌。听牌提示显示听口和剩余可见张数，其他玩家的暗手不会公开。'],
}

export const windKongDescription = '东南西北各一张，须全部位于本人未副露手牌中，在本人摸牌后的回合一次声明，四张亮明并补摸。风杠本身不破门清，不可抢杠。'

function kongChapter(base: number): RuleChapter {
  const rows = [
    ['明杠（直杠）', '手中三张同牌，取得别人弃出的第四张', `放杠者付 ${base} 分`],
    ['补杠', '已经碰牌，摸牌后以第四张升级为杠', `其余三家各付 ${base} 分`],
    ['暗杠', '摸牌后以手中的四张同牌开杠', `其余三家各付 ${base * 2} 分`],
    ['风杠', '摸牌后用暗手中东南西北各一张开杠', `其余三家各付 ${base * 2} 分`],
  ]
  return {
    title: '杠牌与即时收付',
    paragraphs: [
      '杠成立时立即记分，并从牌尾补摸。补杠可被抢胡，被抢时保留原碰，该次补杠不收分也不补牌。',
      windKongDescription,
    ],
    table: { headings: ['杠型', '条件', '收付'], rows },
  }
}

export const congyangRules: readonly RuleChapter[] = [
  { title: '牌具与场制', paragraphs: [fourSeats, `起始分数 2000，基础结算单位 ${BASE_SCORE}。`, matchLength] },
  { title: '翻钻与替代', paragraphs: [
    '开局翻出指示牌，其同序下一张为钻牌（万能牌）。',
    '红中为替代牌，可当作任意钻牌面参与成牌；钻牌未翻出红中时，红中还可当作三万使用。',
    '发财（非钻牌时）摸到或打出后放置在手牌旁边，并从牌墙另一端补摸一张。',
  ] },
  { title: '碰杠与响应', paragraphs: [
    '仅可碰牌、明杠、暗杠、补杠与风杠，不能吃牌，不支持点炮胡（仅可自摸与抢杠胡）。操作优先级：胡 > 杠 > 碰 > 过；听任意时不可抢杠胡。',
    dealerFollow,
  ] },
  { title: '跑风', paragraphs: [
    '完成 3+3+3+3+2 标准胡牌牌型且将牌对子中至少含有一张钻牌（红中非钻牌时不计）时，可选择发动「跑风」：将对子亮出摆在手牌前方（不进牌河），直接轮到下家摸打。',
    '轮转期间其他家可正常碰、杠，跑风者本人不可碰、杠。若顺利轮回跑风者则跑风成功（暂按双倍结算）；若期间他家自摸或抢杠胡（称为「捉」），由跑风者一人包赔三倍积分给捉胡者；牌墙摸空流局按正常流局处理。',
  ] },
  kongChapter(BASE_SCORE),
  controls,
]

export const gameRules: Partial<Record<RuleVariant, readonly RuleChapter[]>> = {
  congyang: congyangRules,
}
