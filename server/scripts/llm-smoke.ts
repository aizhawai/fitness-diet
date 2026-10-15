/**
 * LLM 真实链路冒烟（**会真的花钱调接口**，其余 scripts/ 都是纯本地计算）。
 *
 * 用途：改完 src/ai/llm.ts 的协议适配后跑一下，用真实 Key 验证
 * 「URL / 鉴权头 / thinking 块过滤 / output_config / JSON 提取 / schema 校验」全链路。
 *
 * 跑法：cd server && npx tsx scripts/llm-smoke.ts
 * 前置：server/.env 里 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 三项齐全。
 *
 * 参数按项目约定写死在脚本里，不走命令行传参。
 */

import 'dotenv/config'
import { z } from 'zod'
import { callLlm, getLlmConfig, isLlmConfigured } from '../src/ai/llm.js'

/** 与 chefService 的 aiDishSchema 同形：AI 只给菜名与配料，营养一律后端算 */
const dishSchema = z.object({
  name: z.string().min(1),
  ingredients: z
    .array(z.object({ foodId: z.string().min(1), amount: z.number(), unit: z.string().min(1) }))
    .min(1),
})

const SYSTEM_PROMPT = [
  '你是健身餐搭配助手。你只负责给出菜名与配料克数。',
  '营养数字一律由后端按食材表计算，所以不要输出任何营养数字。',
  '回复必须是且只是一个 JSON 对象，不要任何解释文字。',
].join('\n')

const PROMPT = [
  '请用下面的食材做一道高蛋白低脂的菜。',
  '可用食材 id：ji_xiong_rou（鸡胸肉）、xi_lan_hua（西兰花）、fan_qie（番茄）、jidan（鸡蛋）',
  '严格按下面的 JSON 结构输出，ingredients 数组 1~5 项，不要任何多余字段。',
  '',
  'JSON 结构：',
  '{"name":"菜名","ingredients":[{"foodId":"食材id","amount":克数,"unit":"g"}]}',
].join('\n')

async function main(): Promise<void> {
  if (!isLlmConfigured()) {
    console.error('❌ LLM 未配置齐全（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL），请检查 server/.env')
    process.exitCode = 1
    return
  }

  const cfg = getLlmConfig()
  // 只打印 baseUrl 与模型名，绝不把 Key 打到日志里
  console.log('协议     :', cfg.protocol)
  console.log('地址     :', cfg.baseUrl)
  console.log('模型     :', cfg.model)
  console.log('思考强度 :', cfg.effort === '' ? '(未设置)' : cfg.effort)
  console.log('超时     :', cfg.timeoutMs, 'ms')
  console.log('开始请求…\n')

  const started = Date.now()
  try {
    const dish = await callLlm(PROMPT, {
      schema: dishSchema,
      system: SYSTEM_PROMPT,
      temperature: 0.5,
      maxTokens: 1500,
    })
    console.log(`✅ 成功（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
    console.log(JSON.stringify(dish, null, 2))
  } catch (e) {
    console.error(`❌ 失败（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    process.exitCode = 1
  }
}

await main()
