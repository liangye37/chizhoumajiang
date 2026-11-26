export type RuleVariant = 'congyang' | 'lotus-classic' | 'lotus-legacy' | 'lotus-blood-flow'

export interface RuleVariantOption {
  id: RuleVariant
  name: string
  description: string
  highlights: string[]
  badge?: string
  /** Stable ruleset key used by local/remote engines and future modes. */
  rulesetId?: string
}

export const DEFAULT_RULE_VARIANT: RuleVariant = 'congyang'

export const RULE_VARIANTS: readonly RuleVariantOption[] = [
  {
    id: 'congyang',
    name: '枞阳有钻麻将',
    description: '枞阳本地玩法，翻钻癞子，不能吃牌，红中可当三万',
    highlights: ['翻钻癞子', '不能吃牌', '红中当三万'],
    badge: '默认',
    rulesetId: 'congyang',
  },
]

export function getRuleVariant(id: RuleVariant) {
  const variant = RULE_VARIANTS.find((variant) => variant.id === id)
  if (!variant) throw new Error(`Unknown ruleset: ${id}`)
  return variant
}

export const BLOOD_FLOW_RULE: RuleVariantOption = RULE_VARIANTS[0]
