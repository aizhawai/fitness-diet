/**
 * 菜品偏好反馈接口 + 对应类型。
 *
 * 与 server/src/routes/plan.ts 的 feedbackRoutes、server/src/types.ts 的
 * DishFeedback / FeedbackScore 对齐。
 *
 * 注意路由注册在 plan 路由文件里，但路径是独立的 /api/feedback。
 * 语义：score=-1 的菜之后不会再被生成；score=1 的菜在候选里加权。
 *
 * 用 codeRequest 而不是 request：dishId 不在菜谱库时后端会回 400 + UNKNOWN_DISH，
 * 「AI 现编还没入库的菜不能评价」这句话必须靠错误码才写得出来（见 chefErrorNotice）。
 */

import { codeRequest } from './chef'

/** 1 喜欢 / 0 一般 / -1 不吃 */
export type FeedbackScore = 1 | 0 | -1

export interface DishFeedback {
  dishId: string
  score: FeedbackScore
}

export const FEEDBACK_LABELS: Record<FeedbackScore, string> = {
  1: '喜欢',
  0: '一般',
  '-1': '不吃',
}

/** 标记色：与 chef 页 / 今日页的角标共用一套 */
export const FEEDBACK_COLORS: Record<FeedbackScore, string> = {
  1: '#2fb98a',
  0: '#9aa0aa',
  '-1': '#e0664c',
}

/** 后端 POST /api/feedback 校验失败时用的文案，这里只做兜底展示 */
export const FEEDBACK_SCORE_ERROR = '评分只能是 1（喜欢）/ 0（一般）/ -1（不吃）'

/** 列表 → dishId → score 索引，页面直接查着显示当前状态 */
export function toFeedbackMap(list: DishFeedback[]): Record<string, FeedbackScore> {
  const map: Record<string, FeedbackScore> = {}
  for (const f of list) map[f.dishId] = f.score
  return map
}

/**
 * 三选一的固定顺序，页面直接 v-for 渲染。
 * 放在这里而不是页面里：今日页与 AI 厨师页的菜谱标记要用同一套。
 */
export const FEEDBACK_OPTIONS: Array<{ score: FeedbackScore; label: string }> = [
  { score: 1, label: FEEDBACK_LABELS[1] },
  { score: 0, label: FEEDBACK_LABELS[0] },
  { score: -1, label: FEEDBACK_LABELS['-1'] },
]

/** GET /api/feedback —— 全部已记录的评分（dishId 升序） */
export async function fetchFeedback(): Promise<DishFeedback[]> {
  const res = await codeRequest<{ feedback: DishFeedback[] }>({ url: '/api/feedback' })
  return Array.isArray(res.feedback) ? res.feedback : []
}

/**
 * POST /api/feedback —— 记一条评分（同 dishId 覆盖式，只留最新）。
 *
 * dishId 必须落在菜谱库（内置 + 已存入的我的菜）里，否则后端 400 UNKNOWN_DISH ——
 * AI 现编但还没「存入我的菜谱」的菜就是这种情况，调用方要把这个失败翻译成人话。
 */
export async function postFeedback(
  dishId: string,
  score: FeedbackScore,
): Promise<DishFeedback> {
  const res = await codeRequest<{ feedback: DishFeedback }>({
    url: '/api/feedback',
    method: 'POST',
    data: { dishId, score },
  })
  return res.feedback
}
