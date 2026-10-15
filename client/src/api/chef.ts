/**
 * AI 厨师接口 + 对应类型 + 错误码 → 用户文案映射。
 *
 * 类型与 server/src/services/chefService.ts（CookedDish / ChefError / DishRole）、
 * server/src/routes/chef.ts 的响应体一一对齐。
 *
 * ⚠️ 为什么没有直接复用 api/request.ts 的 request()：
 * 后端把业务错误码放在响应体的 `code` 字段里（NOT_CONFIGURED / LLM_FAILED / EMPTY …），
 * 而 request() 抛出的 ApiError 只保留 error 文案与 issues，取不到 code ——
 * 而「按错误码给不同的降级提示」正是这一层存在的意义。因此这里自带一个极薄的
 * 请求函数 codeRequest()（语义与 request() 完全一致，只是额外把 code / llmKind /
 * missingIds 带出来），api/feedback.ts 也复用它。
 * 后续若在 request.ts 里给 ApiError 补上这三个字段，这里可以改回复用。
 */

import { netState } from './request'
import type {
  DailyPlan,
  FoodBrief,
  Ingredient,
  MacroTarget,
  MealType,
  PlannedDish,
  PlannedDishInfo,
} from './plan'
import { fetchFoods, unitLabel } from './plan'

// 食材表与配料类型沿用 api/plan（同一个 GET /api/foods），这里只做转发
export type { FoodBrief, Ingredient, MacroTarget, MealType }
export { fetchFoods, unitLabel }

// ---------- 菜品结构 ----------

/** 菜品角色，与服务端 DishRole 一致 */
export type DishRole = 'staple' | 'protein' | 'vegetable' | 'simple'

export const ROLE_LABELS: Record<DishRole, string> = {
  staple: '主食',
  protein: '高蛋白',
  vegetable: '素菜',
  simple: '快手菜',
}

/** 单份热量区间（kcal），与服务端 ROLE_KCAL_RANGE 一致，只用于前端提示 */
export const ROLE_KCAL_RANGE: Record<DishRole, { min: number; max: number }> = {
  staple: { min: 180, max: 450 },
  protein: { min: 120, max: 350 },
  vegetable: { min: 40, max: 150 },
  simple: { min: 30, max: 250 },
}

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
}

/** AI 做好的一道菜（尚未入库） */
export interface CookedDish {
  id: string
  name: string
  meals: MealType[]
  role: DishRole
  ingredients: Ingredient[]
  steps: string
  tags: string[]
  /** 后端按食材表实算的，AI 不提供数字 */
  nutrition: MacroTarget
}

/** 入库后的菜（服务端 Dish 的形状） */
export type SavedDish = PlannedDishInfo & { role: DishRole }

// ---------- 食材分类 ----------

export type FoodCategory =
  | 'grain'
  | 'meat_poultry_egg'
  | 'seafood'
  | 'soy'
  | 'dairy'
  | 'vegetable'
  | 'fruit'
  | 'oil_seasoning'

/** 展示顺序与 server/src/types.ts 的 FOOD_CATEGORIES 一致 */
export const FOOD_CATEGORIES: FoodCategory[] = [
  'grain',
  'meat_poultry_egg',
  'seafood',
  'soy',
  'dairy',
  'vegetable',
  'fruit',
  'oil_seasoning',
]

export const CATEGORY_LABELS: Record<FoodCategory, string> = {
  grain: '主食谷物',
  meat_poultry_egg: '肉禽蛋',
  seafood: '水产',
  soy: '豆制品',
  dairy: '乳品',
  vegetable: '蔬菜',
  fruit: '水果',
  oil_seasoning: '油脂调味',
}

/** 食材表里出现了但不在上面 8 类里的（理论上不会），兜个底免得渲染时丢数据 */
export function categoryLabel(category: string): string {
  const known = CATEGORY_LABELS[category as FoodCategory]
  return known ?? category
}

/** 后端 cook 接口一次最多接受的食材数 */
export const MAX_COOK_FOODS = 20

// ---------- 错误 ----------

/** 服务端 LLMError 的分类，见 server/src/ai/llm.ts */
export type LlmErrorKind = 'network' | 'http' | 'timeout' | 'parse' | 'schema' | 'config'

/** 后端可能返回的业务错误码 */
export type ChefErrorCode =
  | 'NOT_CONFIGURED'
  | 'LLM_FAILED'
  | 'UNRESOLVABLE_INGREDIENTS'
  | 'EMPTY'
  | 'UNKNOWN_FOOD'
  | 'UNKNOWN_DISH'
  | 'PLAN_NOT_FOUND'
  | 'INDEX_OUT_OF_RANGE'
  | 'NO_PROFILE'
  | 'NO_WEIGHT'

/**
 * 带业务错误码的接口失败。区别于 request.ts 的 ApiError：
 * 这里额外保留后端响应体里的 code / llmKind / missingIds，
 * 前端据此给「该怎么降级」的提示。
 */
export class CodedApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly llmKind?: LlmErrorKind
  readonly missingIds?: string[]
  readonly issues: string[]

  constructor(
    message: string,
    status: number,
    extra: {
      code?: string
      llmKind?: string
      missingIds?: string[]
      issues?: string[]
    } = {},
  ) {
    super(message)
    this.name = 'CodedApiError'
    this.status = status
    this.issues = extra.issues ?? []
    if (extra.code !== undefined) this.code = extra.code
    if (extra.llmKind !== undefined) this.llmKind = extra.llmKind as LlmErrorKind
    if (extra.missingIds !== undefined) this.missingIds = extra.missingIds
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ---------- 极薄的请求层（理由见文件头注释） ----------

// 与 request.ts 保持一致：H5 走 devServer 代理用相对路径，小程序/APP 必须写全地址。
// 注意必须用 `let` 再条件赋值（uni 的条件编译是注释级预处理，写两次 const 会触发 TS2451）。
let BASE_URL = ''
// #ifdef H5
BASE_URL = ''
// #endif
// #ifndef H5
BASE_URL = 'http://localhost:3000'
// #endif

interface RawErrorBody {
  error?: unknown
  code?: unknown
  llmKind?: unknown
  missingIds?: unknown
  issues?: unknown
}

function readBody(data: unknown): RawErrorBody {
  return typeof data === 'object' && data !== null ? (data as RawErrorBody) : {}
}

/** 从错误体里挖出后端的中文说明（字段名与 request.ts 的 readErrorBody 相同） */
function readErrorMessage(data: unknown): { message: string; issues: string[] } {
  const body = readBody(data)
  const issues = Array.isArray(body.issues)
    ? body.issues.filter((it): it is string => typeof it === 'string')
    : []
  const message = typeof body.error === 'string' ? body.error : ''
  return { message, issues }
}

/**
 * 与 request() 语义一致、但会把后端 `code` / `llmKind` / `missingIds` 一起带出来的请求。
 *
 * api/feedback.ts 也复用它：反馈接口的 UNKNOWN_DISH 同样需要按错误码给不同文案
 * （AI 现编但没入库的菜不能评价），不能只拿到一句「菜谱库里没有这道菜」。
 */
export function codeRequest<T>(options: {
  url: string
  method?: 'GET' | 'POST'
  data?: unknown
  /**  cook / replace-dish 要等大模型，超时放宽到 60s */
  timeout?: number
}): Promise<T> {
  const url = `${BASE_URL}${options.url}`
  netState.pending += 1
  netState.error = ''

  return new Promise<T>((resolve, reject) => {
    uni.request({
      url,
      method: options.method ?? 'GET',
      data: options.data as Record<string, unknown> | undefined,
      header: { 'Content-Type': 'application/json' },
      timeout: options.timeout ?? 15000,
      success: (res) => {
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) {
          resolve(res.data as T)
          return
        }
        const body = readBody(res.data)
        const { message, issues } = readErrorMessage(res.data)
        const text = message || `请求失败（HTTP ${status}）`
        netState.error = text
        reject(
          new CodedApiError(text, status, {
            ...(typeof body.code === 'string' ? { code: body.code } : {}),
            ...(typeof body.llmKind === 'string' ? { llmKind: body.llmKind } : {}),
            ...(Array.isArray(body.missingIds)
              ? { missingIds: body.missingIds.filter((it): it is string => typeof it === 'string') }
              : {}),
            issues,
          }),
        )
      },
      fail: (err) => {
        const raw = err as { errMsg?: string }
        const issues = raw && raw.errMsg ? [raw.errMsg] : []
        netState.error = '网络连接失败，请检查网络后重试'
        reject(new CodedApiError('网络连接失败，请检查网络后重试', 0, { issues }))
      },
      complete: () => {
        netState.pending = Math.max(0, netState.pending - 1)
      },
    })
  })
}

// ---------- 错误码 → 用户文案 ----------

/** 给页面的降级提示：标题 + 说明 + 要不要给「重试」 */
export interface ChefErrorNotice {
  title: string
  desc: string
  /** 值得给一个「重试」按钮 */
  retryable: boolean
  /** 网络层失败（连不上后端），文案是「去检查后端」而不是「重试」 */
  offline: boolean
}

const LLM_KIND_HINTS: Record<LlmErrorKind, string> = {
  timeout: '模型那边迟迟没回。',
  network: '连不上模型服务（网络不通或地址不对）。',
  http: '模型服务返回了错误状态。',
  parse: '模型回复的内容不是合法 JSON。',
  schema: '模型给出的菜谱结构不符合要求。',
  config: '大模型配置不完整。',
}

export interface ChefErrorNoticeOptions {
  /** foodId → 中文名，用于把 missingIds 翻译成人能看懂的名字 */
  foodNames?: Record<string, string>
  /** 是否处于「换一道」场景：没配 AI 时文案要引导回算法换菜 */
  replaceInPlan?: boolean
}

function missingNames(ids: string[] | undefined, foodNames: Record<string, string>): string[] {
  return (ids ?? []).map((id) => foodNames[id] ?? id)
}

/**
 * 把任何异常翻译成给用户看的降级提示。
 *
 * 分支与后端 ChefErrorCode / PlanErrorCode 一一对应；识别不出的一律落到通用提示，
 * **绝不把后端原始 error 文案直接甩给用户**（那是给开发看的）。
 */
export function chefErrorNotice(
  err: unknown,
  opts: ChefErrorNoticeOptions = {},
): ChefErrorNotice {
  const foodNames = opts.foodNames ?? {}
  const inPlan = opts.replaceInPlan === true

  if (!(err instanceof CodedApiError)) {
    return {
      title: '操作失败',
      desc: err instanceof Error && err.message ? err.message : '请稍后重试。',
      retryable: true,
      offline: false,
    }
  }

  // 网络层失败：不是 AI 的锅，是后端没起来
  if (err.status === 0) {
    return {
      title: '连不上后端',
      desc: '请确认后端服务已经启动（server 目录执行 npm run dev，默认监听 3000 端口），然后重试。',
      retryable: true,
      offline: true,
    }
  }

  switch (err.code) {
    case 'NOT_CONFIGURED': {
      const desc = inPlan
        ? 'AI 不可用，今天的食谱保持原样，可以继续用「换一道」按算法换。\n' +
          '想启用：在 server/.env 里填上 LLM_API_KEY 后重启后端。'
        : '在 server/.env 里填上 LLM_API_KEY（以及 LLM_BASE_URL、LLM_MODEL）后重启后端即可使用。\n' +
          '不配置也不影响每日食谱生成 —— 那部分走的是纯算法。'
      return { title: '还没配置 AI', desc, retryable: false, offline: false }
    }

    case 'LLM_FAILED': {
      const kind = err.llmKind
      if (kind === 'timeout') {
        return {
          title: 'AI 响应超时',
          desc: '模型那边迟迟没回，可能是网络慢或服务拥堵。可以直接重试；也可以少选几种食材、换个组合再试。',
          retryable: true,
          offline: false,
        }
      }
      const hint = kind !== undefined ? LLM_KIND_HINTS[kind] : 'AI 服务暂时不可用。'
      const tail = inPlan ? '\n今天的食谱保持原样，可以改用「换一道」按算法换。' : ''
      return {
        title: 'AI 调用失败',
        desc: `${hint}可以直接重试。${tail}`,
        retryable: true,
        offline: false,
      }
    }

    case 'UNRESOLVABLE_INGREDIENTS': {
      const names = missingNames(err.missingIds, foodNames)
      const listed = names.length > 0 ? names.join('、') : '（未知的食材编号）'
      const tail = inPlan ? '\n这道菜保持原样，可以改用「换一道」按算法换。' : ''
      return {
        title: 'AI 认错了食材',
        desc: `它引用了食材表里没有的食材：${listed}。${err.missingIds && err.missingIds.length > 0 ? '' : '换个食材组合再试一次。'}${tail}`,
        retryable: true,
        offline: false,
      }
    }

    case 'EMPTY':
      return {
        title: '这次没做出菜',
        desc: inPlan
          ? '没能给出可用的替换方案，这道菜保持原样。可以换个组合或改用「换一道」按算法换。'
          : '换个食材组合再试试 —— 比如去掉一种你其实不想要的食材。',
        retryable: true,
        offline: false,
      }

    case 'UNKNOWN_FOOD':
      return {
        title: '食材已过期',
        desc: '你选的食材在最新食材表里不存在了，请下拉刷新后重新选择。',
        retryable: false,
        offline: false,
      }

    case 'PLAN_NOT_FOUND':
      return { title: '今天还没有食谱', desc: '先生成今日食谱，再来换菜。', retryable: false, offline: false }

    case 'INDEX_OUT_OF_RANGE':
      return {
        title: '这道菜已经变了',
        desc: '食谱在你操作期间被更新过（可能是重生成过），点「换一道」重试即可。',
        retryable: false,
        offline: false,
      }

    case 'UNKNOWN_DISH':
      return {
        title: '这道菜还不能评价',
        desc: 'AI 现编的菜要先「存入我的菜谱」才能评价；内置菜谱可以直接评价。',
        retryable: false,
        offline: false,
      }

    case 'NO_PROFILE':
      return { title: '还没有档案', desc: '先去档案页完善信息再来生成食谱。', retryable: false, offline: false }

    case 'NO_WEIGHT':
      return { title: '还没有体重记录', desc: '先去档案页记录一次体重，再来生成食谱。', retryable: false, offline: false }

    default:
      return {
        title: '操作失败',
        desc: err.message || '请稍后重试。',
        retryable: true,
        offline: false,
      }
  }
}

// ---------- 接口 ----------

/** POST /api/chef/cook —— 拿着勾选的食材去问 AI 能做什么 */
export async function cookDish(foodIds: string[]): Promise<CookedDish[]> {
  const res = await codeRequest<{ dishes: CookedDish[] }>({
    url: '/api/chef/cook',
    method: 'POST',
    data: { foodIds },
    timeout: 60000,
  })
  return Array.isArray(res.dishes) ? res.dishes : []
}

/** POST /api/chef/save-dish —— 把 AI 做的菜存进 dishes.user.json */
export async function saveDish(dish: CookedDish): Promise<SavedDish> {
  const res = await codeRequest<{ dish: SavedDish }>({
    url: '/api/chef/save-dish',
    method: 'POST',
    data: dish,
  })
  return res.dish
}

/** AI 换一道菜的细节 */
export interface ReplaceDishResult {
  /** 新菜 */
  dish: PlannedDish
  /** 新菜 − 旧菜 */
  nutritionDelta: MacroTarget
  /** 换完之后该餐的汇总营养 */
  mealNutritionAfter: MacroTarget
  /** 换完之后该餐是否落进热量区间 */
  inRange: boolean
  /** 配料是否被后端等比缩放过才落进 role 区间 */
  scaled: boolean
}

export interface AiReplaceResponse {
  result: ReplaceDishResult
  /** 写回后的完整计划，前端整体替换本地 plan */
  plan: DailyPlan
}

/**
 * POST /api/chef/replace-dish —— 把当天计划里的一道菜换成 AI 推荐的新菜。
 *
 * 🔴 失败一律不落库（后端保证），所以调用方 catch 到错误时**不需要回滚任何本地状态**：
 * 保留原菜即可。
 */
export async function replaceDishWithAi(payload: {
  date: string
  mealIndex: number
  dishIndex: number
}): Promise<AiReplaceResponse> {
  return codeRequest<AiReplaceResponse>({
    url: '/api/chef/replace-dish',
    method: 'POST',
    data: payload,
    timeout: 60000,
  })
}

// ---------- 展示用小工具 ----------

/** 克数保留 1 位小数 */
export function fmtAmount(amount: number): string {
  return String(Math.round(amount * 10) / 10)
}

/** 配料拼成「鸡胸肉 120 克、西兰花 100 克」 */
export function ingredientText(
  dish: { ingredients: Ingredient[] },
  foodNames: Record<string, string>,
): string {
  if (dish.ingredients.length === 0) return '（无配料）'
  return dish.ingredients
    .map(
      (ing) =>
        `${foodNames[ing.foodId] ?? ing.foodId} ${fmtAmount(ing.amount)}${unitLabel(ing.unit)}`,
    )
    .join('、')
}
