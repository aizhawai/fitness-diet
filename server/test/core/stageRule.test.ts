/**
 * suggestStage · 饮食结构阶段提醒
 *
 * 边界归属（本文件钉死的口径）：
 *   remainingKg <= 0            → reached  + maintain   + strong
 *   0 < remainingKg < 2         → nearing  + balanced_cut + strong
 *   2 <= remainingKg <= 5       → nearing  + balanced_cut + soft     （5kg / 2kg 都归 soft）
 *   remainingKg > 5             → cutting  + null        + none
 * 体重历史按 date 取最大值，非法记录忽略，同日期取后出现的那条。
 */

import { describe, expect, it } from 'vitest'
import { suggestStage } from '../../src/core/stageRule.js'
import type { StageSuggestion, WeightPoint } from '../../src/core/stageRule.js'
import type { DietStructureKey } from '../../src/types.js'

/** 构造一条体重记录 */
const W = (date: string, weightKg: number): WeightPoint => ({ date, weightKg })

/** 只有一条记录：当前体重 = w，目标 = goal */
const single = (
  w: number,
  goal: number | null,
  current: DietStructureKey = 'high_protein',
): StageSuggestion => suggestStage({ weightHistory: [W('2026-03-15', w)], goalWeightKg: goal, currentStructure: current })

/** 判断 message 是非空中文且长度合理（6~60 个字符） */
function expectChineseMessage(msg: string): void {
  expect(typeof msg).toBe('string')
  expect(msg.trim().length).toBeGreaterThan(0)
  expect(msg.length).toBeGreaterThanOrEqual(6)
  expect(msg.length).toBeLessThanOrEqual(60)
  expect(msg).toMatch(/[一-龥]/)
}

const CUT_KEYS: DietStructureKey[] = ['high_protein', 'balanced_cut', 'low_carb']
/** 需要切到 balanced_cut 的结构（balanced_cut 本身已在目标结构上，另行单独测） */
const SWITCH_KEYS: DietStructureKey[] = ['high_protein', 'low_carb']
const ALL_KEYS: DietStructureKey[] = ['balanced_cut', 'high_protein', 'low_carb', 'maintain']

describe('suggestStage · 距目标 > 5kg（减脂期，维持现结构）', () => {
  it.each([
    ['10kg', 85, 75],
    ['6kg', 81, 75],
  ])('距目标 %s → cutting + urgency none + 不给建议', (_tag, w, goal) => {
    const r = single(w, goal)
    expect(r.stage).toBe('cutting')
    expect(r.label).toBe('减脂期')
    expect(r.urgency).toBe('none')
    expect(r.suggestStructure).toBeNull()
    expect(r.remainingKg).toBeCloseTo(w - goal, 10)
  })

  it.each([85, 81])('距目标 >5kg 时，对任意当前结构都不催（当前=%s 不传，仅校验三种减脂结构）', (w) => {
    for (const cur of CUT_KEYS) {
      const r = single(w, 75, cur)
      expect(r.suggestStructure).toBeNull()
      expect(r.urgency).toBe('none')
    }
  })

  it('距目标 6kg（刚过 5kg 边界）不催，5.1kg 也不催', () => {
    for (const rem of [6, 5.1]) {
      const r = single(80, 80 - rem)
      expect(r.urgency).toBe('none')
      expect(r.suggestStructure).toBeNull()
    }
  })
})

describe('suggestStage · 边界值归属（5kg / 2kg 都归 soft）', () => {
  it.each([
    ['恰好 5kg', 80, 75],
    ['恰好 2kg', 77, 75],
    ['2~5kg 之间 3kg', 78, 75],
  ])('%s → nearing + soft + balanced_cut', (_tag, w, goal) => {
    const r = single(w, goal)
    expect(r.stage).toBe('nearing')
    expect(r.urgency).toBe('soft')
    expect(r.suggestStructure).toBe('balanced_cut')
  })

  it('刚好低于 2kg（1.94kg）就升级为 strong', () => {
    const r = single(76.94, 75)
    expect(r.stage).toBe('nearing')
    expect(r.urgency).toBe('strong')
    expect(r.suggestStructure).toBe('balanced_cut')
  })

  it('刚好超过 5kg（5.06kg）就是 none', () => {
    const r = single(80.06, 75)
    expect(r.urgency).toBe('none')
    expect(r.suggestStructure).toBeNull()
  })

  it('剩余量先四舍五入到 1 位小数再分档：1.99kg→2.0 归 soft，5.01kg→5.0 也归 soft', () => {
    // 距目标先取 1 位小数（全局约定），所以 1.99 与 5.01 都会被抹到边界内侧
    expect(single(76.99, 75).remainingKg).toBe(2)
    expect(single(76.99, 75).urgency).toBe('soft')
    expect(single(80.01, 75).remainingKg).toBe(5)
    expect(single(80.01, 75).urgency).toBe('soft')
  })
})

describe('suggestStage · 距目标 2~5kg（soft，建议均衡减脂）', () => {
  it('距目标 3kg → soft + balanced_cut', () => {
    const r = single(78, 75)
    expect(r.stage).toBe('nearing')
    expect(r.remainingKg).toBe(3)
    expect(r.urgency).toBe('soft')
    expect(r.suggestStructure).toBe('balanced_cut')
  })

  it.each(SWITCH_KEYS)('当前是 %s 且距目标 3kg → 建议切到 balanced_cut', (cur) => {
    const r = single(78, 75, cur)
    expect(r.suggestStructure).toBe('balanced_cut')
    expect(r.urgency).toBe('soft')
  })
})

describe('suggestStage · 距目标 < 2kg（strong）', () => {
  it('距目标 1kg → strong + balanced_cut', () => {
    const r = single(76, 75)
    expect(r.stage).toBe('nearing')
    expect(r.remainingKg).toBe(1)
    expect(r.urgency).toBe('strong')
    expect(r.suggestStructure).toBe('balanced_cut')
  })

  it.each(SWITCH_KEYS)('当前是 %s 且距目标 1kg → strong + balanced_cut', (cur) => {
    const r = single(76, 75, cur)
    expect(r.urgency).toBe('strong')
    expect(r.suggestStructure).toBe('balanced_cut')
  })
})

describe('suggestStage · 已达目标（切到正常饮食）', () => {
  it('当前体重 = 目标体重 → reached + maintain + strong', () => {
    const r = single(75, 75)
    expect(r.stage).toBe('reached')
    expect(r.label).toBe('已达目标')
    expect(r.remainingKg).toBe(0)
    expect(r.urgency).toBe('strong')
    expect(r.suggestStructure).toBe('maintain')
  })

  it('当前体重 < 目标体重（超额完成）→ 同样 reached + maintain + strong，remainingKg 为负', () => {
    const r = single(73.4, 75)
    expect(r.stage).toBe('reached')
    expect(r.urgency).toBe('strong')
    expect(r.suggestStructure).toBe('maintain')
    expect(r.remainingKg).toBeLessThan(0)
    expect(r.remainingKg).toBeCloseTo(-1.6, 10)
  })

  it.each(CUT_KEYS)('从减脂结构 %s 达标 → 建议切到 maintain', (cur) => {
    const r = single(75, 75, cur)
    expect(r.suggestStructure).toBe('maintain')
    expect(r.urgency).toBe('strong')
  })

  it('已经处于正常饮食且已达标 → 无需再切，urgency 降为 none', () => {
    const r = single(74, 75, 'maintain')
    expect(r.stage).toBe('reached')
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
  })
})

describe('suggestStage · 维持期（已在正常饮食但还没达标）', () => {
  it('当前结构是 maintain 且距目标 8kg → maintaining，不强推切换', () => {
    const r = single(83, 75, 'maintain')
    expect(r.stage).toBe('maintaining')
    expect(r.label).toBe('维持期')
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
    expect(r.remainingKg).toBe(8)
  })

  it('当前结构是 maintain 且距目标 1kg → 仍按距离判定为 nearing', () => {
    const r = single(76, 75, 'maintain')
    expect(r.stage).toBe('nearing')
    expect(r.suggestStructure).toBe('balanced_cut')
  })
})

describe('suggestStage · 无目标体重 / 无体重记录', () => {
  it('goalWeightKg 为 null → 不给结构建议，只返回 cutting', () => {
    for (const w of [90, 78, 75]) {
      const r = single(w, null)
      expect(r.stage).toBe('cutting')
      expect(r.suggestStructure).toBeNull()
      expect(r.urgency).toBe('none')
    }
  })

  it('goalWeightKg 为 null 时也不触发掉秤放缓建议', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-02', 90.2), W('2026-03-15', 90)],
      goalWeightKg: null,
      currentStructure: 'high_protein',
    })
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
  })

  it('goalWeightKg 非有限或非正数 → 视同未设置目标', () => {
    for (const bad of [0, -5, NaN]) {
      const r = single(90, bad)
      expect(r.stage).toBe('cutting')
      expect(r.suggestStructure).toBeNull()
      expect(r.urgency).toBe('none')
    }
  })

  it('weightHistory 为空数组 → 不崩，返回 cutting + none', () => {
    const r = suggestStage({ weightHistory: [], goalWeightKg: 75, currentStructure: 'high_protein' })
    expect(r.stage).toBe('cutting')
    expect(r.urgency).toBe('none')
    expect(r.suggestStructure).toBeNull()
    expect(r.remainingKg).toBe(0)
  })

  it('weightHistory 全部非法 → 等同空数组，不崩', () => {
    const r = suggestStage({
      weightHistory: [W('2026/03/15', 80), W('乱写', 79), W('2026-03-15', NaN)],
      goalWeightKg: 75,
      currentStructure: 'high_protein',
    })
    expect(r.stage).toBe('cutting')
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
  })
})

describe('suggestStage · 体重历史排序（乱序 / 重复日期 / 非法记录）', () => {
  it('history 乱序：取 date 最大那条，而不是数组最后一条', () => {
    // 最后一条是 03-05（79kg），但最新日期是 03-15（78kg）
    const r = suggestStage({
      weightHistory: [W('2026-03-15', 78), W('2026-03-10', 78.5), W('2026-03-05', 79)],
      goalWeightKg: 75,
      currentStructure: 'high_protein',
    })
    expect(r.remainingKg).toBe(3)
    expect(r.urgency).toBe('soft')
  })

  it('history 乱序且把最新日期放中间，也能取对', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-05', 79), W('2026-03-15', 78), W('2026-03-10', 78.5)],
      goalWeightKg: 75,
      currentStructure: 'high_protein',
    })
    expect(r.remainingKg).toBe(3)
  })

  it('history 重复日期 → 取后出现的那条（同一天 82 → 78 → 80，取最后的 80kg）', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-15', 82), W('2026-03-15', 78), W('2026-03-15', 80)],
      goalWeightKg: 75,
      currentStructure: 'high_protein',
    })
    expect(r.remainingKg).toBe(5)
    expect(r.urgency).toBe('soft')
  })

  it('最新那条非法（日期格式错 / 体重非正）→ 顺延取上一条合法记录', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-10', 76), W('2026-03-20', 0), W('2026-03-18', -3)],
      goalWeightKg: 75,
      currentStructure: 'high_protein',
    })
    expect(r.remainingKg).toBe(1)
    expect(r.urgency).toBe('strong')
  })

  it('不存在的日期（2026-02-30）视为非法记录被忽略', () => {
    const r = suggestStage({
      weightHistory: [W('2026-02-30', 70), W('2026-03-15', 76)],
      goalWeightKg: 75,
      currentStructure: 'high_protein',
    })
    expect(r.remainingKg).toBe(1)
  })
})

describe('suggestStage · 当前结构已经是建议结构', () => {
  it('soft 档且已是 balanced_cut → suggestStructure null + urgency none', () => {
    const r = single(78, 75, 'balanced_cut')
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
    expect(r.stage).toBe('nearing')
  })

  it('strong 档且已是 balanced_cut → suggestStructure null + urgency none', () => {
    const r = single(76, 75, 'balanced_cut')
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
  })

  it('low_carb 距目标很近时也建议切到 balanced_cut', () => {
    const soft = single(77, 75, 'low_carb')
    expect(soft.suggestStructure).toBe('balanced_cut')
    expect(soft.urgency).toBe('soft')

    const strong = single(75.5, 75, 'low_carb')
    expect(strong.suggestStructure).toBe('balanced_cut')
    expect(strong.urgency).toBe('strong')
  })

  it('已达目标且已是 maintain → null + none', () => {
    const r = single(74, 74.5, 'maintain')
    expect(r.stage).toBe('reached')
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
  })
})

describe('suggestStage · 减重放缓（加分规则）', () => {
  it('最近 14 天仅下降 0.2kg 且仍在减脂期 → 建议 low_carb + soft', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-02', 90.2), W('2026-03-08', 90.1), W('2026-03-15', 90)],
      goalWeightKg: 70,
      currentStructure: 'high_protein',
    })
    expect(r.stage).toBe('cutting')
    expect(r.suggestStructure).toBe('low_carb')
    expect(r.urgency).toBe('soft')
    expect(r.message).toContain('掉秤变慢')
  })

  it('14 天窗口以最新记录为基准：窗口外的旧记录不参与判断', () => {
    // 03-01 的 92kg 在 14 天窗口之外（最新 03-15，回看 13 天即 03-02 起）
    const r = suggestStage({
      weightHistory: [W('2026-03-01', 92), W('2026-03-02', 90.2), W('2026-03-15', 90)],
      goalWeightKg: 70,
      currentStructure: 'high_protein',
    })
    expect(r.suggestStructure).toBe('low_carb')
    expect(r.urgency).toBe('soft')
  })

  it('窗口内降幅达到 0.3kg → 不触发放缓', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-02', 90.3), W('2026-03-15', 90)],
      goalWeightKg: 70,
      currentStructure: 'high_protein',
    })
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
  })

  it('窗口内体重大幅反弹 → 同样触发放缓', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-02', 89), W('2026-03-15', 90.5)],
      goalWeightKg: 70,
      currentStructure: 'balanced_cut',
    })
    expect(r.suggestStructure).toBe('low_carb')
    expect(r.urgency).toBe('soft')
  })

  it('观察窗口太短（不足 7 天）不足以判断趋势 → 不触发', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-14', 90.1), W('2026-03-15', 90)],
      goalWeightKg: 70,
      currentStructure: 'high_protein',
    })
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
  })

  it('窗口内只有一条记录 → 无法判断趋势，不触发', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-15', 90)],
      goalWeightKg: 70,
      currentStructure: 'high_protein',
    })
    expect(r.suggestStructure).toBeNull()
  })

  it('已经是 low_carb → 不再建议切 low_carb，urgency none，但 message 仍点出放缓', () => {
    const r = suggestStage({
      weightHistory: [W('2026-03-02', 90.2), W('2026-03-15', 90)],
      goalWeightKg: 70,
      currentStructure: 'low_carb',
    })
    expect(r.suggestStructure).toBeNull()
    expect(r.urgency).toBe('none')
    expect(r.message).toContain('掉秤变慢')
  })

  it('放缓规则只在减脂期生效，nearing / reached 仍按距离判定', () => {
    const stalling = [W('2026-03-02', 78.2), W('2026-03-15', 78)]
    const nearing = suggestStage({
      weightHistory: stalling,
      goalWeightKg: 75,
      currentStructure: 'high_protein',
    })
    expect(nearing.suggestStructure).toBe('balanced_cut')
    expect(nearing.urgency).toBe('soft')

    const reached = suggestStage({
      weightHistory: stalling,
      goalWeightKg: 78,
      currentStructure: 'high_protein',
    })
    expect(reached.stage).toBe('reached')
    expect(reached.suggestStructure).toBe('maintain')
    expect(reached.urgency).toBe('strong')
  })
})

describe('suggestStage · 返回值规约', () => {
  it('label 与 stage 一一对应', () => {
    expect(single(90, 75).label).toBe('减脂期')
    expect(single(78, 75).label).toBe('接近目标')
    expect(single(74, 75).label).toBe('已达目标')
    expect(single(83, 75, 'maintain').label).toBe('维持期')
  })

  it('remainingKg 统一保留 1 位小数', () => {
    const r = single(80.04, 75)
    expect(r.remainingKg).toBe(5)
    expect(Math.abs(r.remainingKg * 10 - Math.round(r.remainingKg * 10))).toBeLessThan(1e-9)
  })

  it('每种场景下 message 都是非空中文且长度合理', () => {
    const scenarios: Array<{ w: number; goal: number | null; cur: DietStructureKey }> = [
      { w: 90, goal: 75, cur: 'high_protein' },
      { w: 80, goal: 75, cur: 'high_protein' },
      { w: 78, goal: 75, cur: 'high_protein' },
      { w: 78, goal: 75, cur: 'balanced_cut' },
      { w: 76, goal: 75, cur: 'low_carb' },
      { w: 76, goal: 75, cur: 'balanced_cut' },
      { w: 75, goal: 75, cur: 'high_protein' },
      { w: 73, goal: 75, cur: 'maintain' },
      { w: 83, goal: 75, cur: 'maintain' },
      { w: 90, goal: null, cur: 'low_carb' },
    ]
    for (const s of scenarios) {
      expectChineseMessage(single(s.w, s.goal, s.cur).message)
    }
    expectChineseMessage(
      suggestStage({ weightHistory: [], goalWeightKg: 75, currentStructure: 'high_protein' }).message,
    )
    expectChineseMessage(
      suggestStage({
        weightHistory: [W('2026-03-02', 90.2), W('2026-03-15', 90)],
        goalWeightKg: 70,
        currentStructure: 'high_protein',
      }).message,
    )
  })

  it('返回值不含任何「自动切换」语义字段（只有提醒）', () => {
    const r = single(78, 75)
    expect(Object.keys(r).sort()).toEqual(
      ['label', 'message', 'remainingKg', 'stage', 'suggestStructure', 'urgency'].sort(),
    )
    expect(r).not.toHaveProperty('autoApply')
    expect(r).not.toHaveProperty('shouldApply')
  })

  it('四种结构 × 多档距离：返回结构始终合法且字段完整', () => {
    for (const cur of ALL_KEYS) {
      for (const goal of [null, 90, 80, 76, 75, 74]) {
        const r = single(80, goal, cur)
        expect(['cutting', 'nearing', 'reached', 'maintaining']).toContain(r.stage)
        expect(['none', 'soft', 'strong']).toContain(r.urgency)
        expect(Number.isFinite(r.remainingKg)).toBe(true)
        if (r.suggestStructure !== null) expect(ALL_KEYS).toContain(r.suggestStructure)
        expectChineseMessage(r.message)
        // suggestStructure 为 null 时不应还带着非 none 的强度
        if (r.suggestStructure === null) expect(r.urgency).toBe('none')
      }
    }
  })
})