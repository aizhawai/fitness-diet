/**
 * 饮食结构阶段提醒：根据「距目标还差多少 kg」给出是否该切换饮食结构的建议。
 * 纯函数模块，不依赖 db / fs / 网络 / 框架，体重历史一律由调用方传入。
 *
 * 重要：本模块只做「提醒」，返回值里没有任何自动切换的语义，
 * 是否采纳由用户/上层决定（因此没有 autoApply 之类的字段）。
 */

import { DIET_STRUCTURE_LABELS } from '../types.js'
import type { DietStructureKey } from '../types.js'

/** 减脂阶段 */
export type Stage = 'cutting' | 'nearing' | 'reached' | 'maintaining'

/** 一条体重记录 */
export interface WeightPoint {
  /** YYYY-MM-DD */
  date: string
  weightKg: number
}

/** 建议强度：none 不提醒 / soft 建议 / strong 强烈建议 */
export type StageUrgency = 'none' | 'soft' | 'strong'

export interface StageSuggestion {
  stage: Stage
  /** 中文短描述，如「减脂期」「接近目标」「已达目标」 */
  label: string
  /** 距目标还有多少 kg；已达目标为 0 或负数；未设目标时为 0 */
  remainingKg: number
  /** 建议切换到哪个饮食结构；不需切换时为 null */
  suggestStructure: DietStructureKey | null
  urgency: StageUrgency
  /** 给前端展示的一句话 */
  message: string
}

// ---------- 阈值 ----------

/** 距目标超过 5kg：维持现结构，不提醒 */
export const SOFT_THRESHOLD_KG = 5
/** 距目标不足 2kg：强烈建议切到均衡减脂 */
export const STRONG_THRESHOLD_KG = 2
/** 观察掉秤速度的回看窗口（天，含当天，共 14 个自然日） */
export const PLATEAU_WINDOW_DAYS = 14
/** 窗口内至少要覆盖这么多天才够判断趋势，否则数据太少不下结论 */
export const PLATEAU_MIN_SPAN_DAYS = 7
/** 窗口内掉秤低于这个数就认为「掉秤变慢」 */
export const PLATEAU_MIN_DROP_KG = 0.3

/** 进入 nearing 档后统一建议的结构 */
const NEAR_TARGET_STRUCTURE: DietStructureKey = 'balanced_cut'
/** 达标后建议的结构 */
const REACHED_STRUCTURE: DietStructureKey = 'maintain'
/** 掉秤变慢时建议的结构 */
const PLATEAU_STRUCTURE: DietStructureKey = 'low_carb'

/** 各阶段的中文短描述 */
const STAGE_LABELS: Record<Stage, string> = {
  cutting: '减脂期',
  nearing: '接近目标',
  reached: '已达目标',
  maintaining: '维持期',
}

// ---------- 内部工具 ----------

/** 统一保留 1 位小数，消掉 -0 */
function round1(v: number): number {
  const r = Math.round(v * 10) / 10
  return r === 0 ? 0 : r
}

/** 数字转中文文案里的短文本 */
function fmt(v: number): string {
  return String(round1(v))
}

/**
 * YYYY-MM-DD → 距 1970-01-01 的天数；格式不对或不存在的日期（如 2026-02-30）返回 NaN。
 * 用 Date.UTC 纯计算，不读系统时钟。
 */
function dayIndex(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return NaN
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const ms = Date.UTC(y, mo - 1, d)
  const dt = new Date(ms)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN
  return Math.floor(ms / 86400000)
}

/** 合法记录：日期格式正确且体重是正的有限数 */
function isValid(p: WeightPoint | null | undefined): p is WeightPoint {
  if (!p || typeof p.date !== 'string' || typeof p.weightKg !== 'number') return false
  return Number.isFinite(p.weightKg) && p.weightKg > 0 && Number.isFinite(dayIndex(p.date))
}

/**
 * 取「最新一条」体重：按 date 取最大值，忽略非法记录；
 * date 相同取后出现的那条（>= 让后来的覆盖先前的），而不是数组最后一条。
 */
function selectLatest(history: WeightPoint[]): WeightPoint | null {
  let best: WeightPoint | null = null
  for (const p of history) {
    if (!isValid(p)) continue
    if (best === null || p.date >= best.date) best = p
  }
  return best
}

/**
 * 掉秤速度判断：在「以最新记录为今天」的 14 天回看窗口内取最早的一条合法记录作为基线。
 * 窗口不足 7 天（数据太少）或窗口内只有一条 → 返回 null，表示无法判断。
 */
function selectBaseline(history: WeightPoint[], latestDay: number): WeightPoint | null {
  const from = latestDay - (PLATEAU_WINDOW_DAYS - 1)
  let best: WeightPoint | null = null
  let bestDay = Number.POSITIVE_INFINITY
  for (const p of history) {
    if (!isValid(p)) continue
    const day = dayIndex(p.date)
    if (day < from || day > latestDay) continue
    if (best === null || day <= bestDay) {
      best = p
      bestDay = day
    }
  }
  if (best === null) return null
  // 观察跨度不够就不下结论，避免拿两三天的抖动当「掉秤变慢」
  if (latestDay - bestDay < PLATEAU_MIN_SPAN_DAYS) return null
  return best
}

/**
 * 组装返回值。若 suggestion 等于当前结构，说明没什么可切的：
 * suggestStructure 置 null、urgency 降为 none（提醒没有意义）。
 */
function build(
  stage: Stage,
  remainingKg: number,
  suggestion: DietStructureKey | null,
  urgency: StageUrgency,
  message: string,
  currentStructure: DietStructureKey,
): StageSuggestion {
  const needSwitch = suggestion !== null && suggestion !== currentStructure
  return {
    stage,
    label: STAGE_LABELS[stage],
    remainingKg,
    suggestStructure: needSwitch ? suggestion : null,
    urgency: needSwitch ? urgency : 'none',
    message,
  }
}

/** 某结构的中文名 */
function name(k: DietStructureKey): string {
  return DIET_STRUCTURE_LABELS[k]
}

// ---------- 主函数 ----------

export interface SuggestStageInput {
  /** 体重历史，可空、乱序、可含非法记录 */
  weightHistory: WeightPoint[]
  /** 目标体重 kg，可空 */
  goalWeightKg: number | null
  /** 当前正在使用的饮食结构 */
  currentStructure: DietStructureKey
}

/**
 * 根据体重与目标，给出饮食结构的阶段提醒。
 *
 * 判定口径（以最新一条体重为准）：
 *   remainingKg <= 0        → reached   建议切到正常饮食 maintain（strong）
 *   0 < remainingKg < 2     → nearing   建议切到均衡减脂 balanced_cut（strong）
 *   2 <= remainingKg <= 5   → nearing   建议切到均衡减脂 balanced_cut（soft）
 *   remainingKg > 5         → cutting   维持现结构，不提醒（none）
 *
 * 补充规则：
 * - 没有体重记录，或没设目标体重 → 无法判断，只返回 cutting + none，不给结构建议
 * - 当前已是 normal饮食（maintain）且距目标 > 5kg → 标记为 maintaining，只描述现状不催切换
 * - 仍在减脂期（距目标 > 5kg）但最近 14 天掉秤 < 0.3kg → 建议改用低碳 low_carb（soft）
 *
 * @returns 阶段、距目标差值、结构建议、强度与一句中文提示；仅提醒，不自动切换
 */
export function suggestStage(input: SuggestStageInput): StageSuggestion {
  const { weightHistory, goalWeightKg, currentStructure } = input
  const history = Array.isArray(weightHistory) ? weightHistory : []

  // 无体重记录：无法判断阶段
  const latest = selectLatest(history)
  if (latest === null) {
    return {
      stage: 'cutting',
      label: STAGE_LABELS.cutting,
      remainingKg: 0,
      suggestStructure: null,
      urgency: 'none',
      message: '暂无体重记录，先记录体重后再判断减脂阶段',
    }
  }

  // 目标体重缺失或非法（非有限 / 非正）：不给结构建议，只返回 cutting
  const goal =
    typeof goalWeightKg === 'number' && Number.isFinite(goalWeightKg) && goalWeightKg > 0
      ? goalWeightKg
      : null
  if (goal === null) {
    return {
      stage: 'cutting',
      label: STAGE_LABELS.cutting,
      remainingKg: 0,
      suggestStructure: null,
      urgency: 'none',
      message: '还未设置目标体重，先设置目标才能给出饮食结构建议',
    }
  }

  // 先四舍五入到 1 位小数再比较，避免浮点尾差把「恰好 5kg」错分到 >5 档
  const remainingKg = round1(latest.weightKg - goal)

  // 1) 已达目标：切到正常饮食进入维持期
  if (remainingKg <= 0) {
    const extra = remainingKg < 0 ? `（已低于目标 ${fmt(-remainingKg)} kg）` : ''
    const msg =
      currentStructure === REACHED_STRUCTURE
        ? `已达到目标体重${extra}，当前已是正常饮食，继续保持即可`
        : `已达到目标体重${extra}，建议切换到正常饮食进入维持期`
    return build('reached', remainingKg, REACHED_STRUCTURE, 'strong', msg, currentStructure)
  }

  // 2) 已达目标但还没到：按距离分档
  if (remainingKg <= SOFT_THRESHOLD_KG) {
    const strong = remainingKg < STRONG_THRESHOLD_KG
    const near = strong ? '只剩' : '还有'
    const msg =
      currentStructure === NEAR_TARGET_STRUCTURE
        ? `距离目标${near} ${fmt(remainingKg)} kg，当前已是${name(NEAR_TARGET_STRUCTURE)}，请守住最后一段`
        : `距离目标${near} ${fmt(remainingKg)} kg，建议切换到${name(NEAR_TARGET_STRUCTURE)}结构，减得更稳也更容易守住目标`
    return build('nearing', remainingKg, NEAR_TARGET_STRUCTURE, strong ? 'strong' : 'soft', msg, currentStructure)
  }

  // 3) 距目标 > 5kg：正常是「维持现结构不提醒」
  //    例外一：已经在正常饮食维持 → 标为 maintaining，只描述现状
  if (currentStructure === REACHED_STRUCTURE) {
    return build(
      'maintaining',
      remainingKg,
      null,
      'none',
      `当前处于${name(REACHED_STRUCTURE)}维持期，距离目标还有 ${fmt(remainingKg)} kg，想继续减可切换到${name(NEAR_TARGET_STRUCTURE)}`,
      currentStructure,
    )
  }

  //    例外二：掉秤变慢 → 建议改低碳结构（soft）
  const baseline = selectBaseline(history, dayIndex(latest.date))
  if (baseline !== null) {
    const drop = round1(baseline.weightKg - latest.weightKg)
    if (drop < PLATEAU_MIN_DROP_KG) {
      const how = drop <= 0 ? `近 ${PLATEAU_WINDOW_DAYS} 天体重没有下降` : `近 ${PLATEAU_WINDOW_DAYS} 天只掉了 ${fmt(drop)} kg`
      const msg =
        currentStructure === PLATEAU_STRUCTURE
          ? `近期掉秤变慢（${how}），当前已是${name(PLATEAU_STRUCTURE)}，可考虑调整热量缺口或增加活动量`
          : `近期掉秤变慢（${how}），可考虑切换到${name(PLATEAU_STRUCTURE)}结构加强减脂`
      return build('cutting', remainingKg, PLATEAU_STRUCTURE, 'soft', msg, currentStructure)
    }
  }

  // 4) 常规减脂期：维持现结构
  return build(
    'cutting',
    remainingKg,
    null,
    'none',
    `距离目标还有 ${fmt(remainingKg)} kg，继续保持现有饮食结构，按计划减脂即可`,
    currentStructure,
  )
}