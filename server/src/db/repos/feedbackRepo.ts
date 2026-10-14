/**
 * 菜品反馈仓储。dish_feedback 按 dish_id 唯一，同一道菜的评分只保留最新一条。
 *
 * score：1 喜欢 / 0 一般 / -1 不吃。planner 生成时会读这里，
 * score === -1 的菜直接从候选里剔除。
 */

import type { DatabaseSync } from 'node:sqlite'
import type { DishFeedback, FeedbackScore } from '../../types.js'

const SCORES: readonly FeedbackScore[] = [1, 0, -1]

/** 行 → 反馈（行是 null-prototype，这里显式构造普通对象） */
function toFeedback(row: Record<string, unknown>): DishFeedback {
  const raw = Number(row['score'])
  const score: FeedbackScore = SCORES.includes(raw as FeedbackScore) ? (raw as FeedbackScore) : 0
  return { dishId: String(row['dish_id'] ?? ''), score }
}

/** 列出全部反馈（按 id 升序，保证读取顺序稳定） */
export function listFeedback(db: DatabaseSync): DishFeedback[] {
  const rows = db
    .prepare('SELECT dish_id, score FROM dish_feedback ORDER BY dish_id ASC')
    .all() as Array<Record<string, unknown>>
  return rows.map(toFeedback)
}

/** 写入（或覆盖）某道菜的评分 */
export function setFeedback(db: DatabaseSync, dishId: string, score: FeedbackScore): void {
  if (!SCORES.includes(score)) {
    throw new Error(`setFeedback: score 只能是 1 / 0 / -1，实际为 ${String(score)}`)
  }
  db.prepare(
    `INSERT INTO dish_feedback (dish_id, score) VALUES (?, ?)
     ON CONFLICT(dish_id) DO UPDATE SET
       score = excluded.score,
       updated_at = datetime('now')`,
  ).run(dishId, score)
}