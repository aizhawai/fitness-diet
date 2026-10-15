# 健身减脂饮食管理应用 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **约束：本计划为文档交付物，任务内不含实现代码；每个步骤以「做什么/怎么做/怎么验证」描述，实现时由执行者按设计文档 `docs/superpowers/specs/2026-10-14-fitness-diet-design.md` 落码。**

**Goal:** 本地前后端应用：按体重动态计算每日热量与宏量目标，算法生成不重复的每日食谱，AI 增强（看料做菜/换菜/兜底），数据存本地 SQLite。

**Architecture:** 后端 Fastify + 分层（routes 薄路由 / services 编排 / core 纯函数算法 / db repos / ai 适配器 / data 静态数据包）；前端 uni-app Vue3 + Pinia，只做展示与交互，不做营养计算。

**Tech Stack:** Node.js 24 + TypeScript + Fastify + better-sqlite3 + zod + vitest；uni-app (Vue3 + Vite + Pinia)；OpenAI 兼容 LLM API。

**通用规则（所有任务生效）：**
- 遵循 TDD：core/ 与可测逻辑先写失败测试，再实现
- 每个任务完成即 git commit（消息格式 `feat/fix/test/docs: 中文描述`）
- 所有 API 入参与 LLM 输出用 zod schema 校验
- 食材/菜谱数据包是 JSON 文件，字段结构以设计文档第 5 节为准

---

# 里程碑 M1：基础闭环

**验收标准：改体重，目标热量立刻变。** 前端今日页能显示今日目标热量与三大宏量。

## Task 1: 后端项目脚手架

**Files:**
- Create: `fitness-diet/server/package.json`、`fitness-diet/server/tsconfig.json`、`fitness-diet/server/src/index.ts`（临时空壳）、`fitness-diet/server/.env.example`、`fitness-diet/server/.gitignore`、`fitness-diet/.gitignore`（根级）

- [ ] **Step 1.1** 在 `fitness-diet/` 目录下初始化 git 仓库（`git init`）
- [ ] **Step 1.2** 创建 `server/` 目录，`npm init` 并安装依赖：fastify、better-sqlite3、zod、dotenv；dev 依赖：typescript、tsx、vitest、@types/node、@types/better-sqlite3
- [ ] **Step 1.3** 配置 tsconfig（ESM、strict、NodeNext 模块解析），配 `npm run dev`（tsx watch）与 `npm test`（vitest run）脚本
- [ ] **Step 1.4** 写 `.env.example`（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 三个占位）与 `.gitignore`（node_modules、.env、data/app.db）
- [ ] **Step 1.5** 写最小 `src/index.ts`：加载 dotenv、启动 Fastify 监听 3000、注册一个 `GET /api/health` 返回 `{ok:true}`
- [ ] **Step 1.6** 验证：`npm run dev` 后 `curl localhost:3000/api/health` 返回 ok
- [ ] **Step 1.7** Commit：`feat: 后端项目脚手架`

## Task 2: 数据库建表与连接

**Files:**
- Create: `server/src/db/sqlite.ts`
- Test: `server/test/db/sqlite.test.ts`

- [ ] **Step 2.1** 写失败测试：用 `:memory:` 内存库调用初始化函数后，sqlite_master 中存在 profile / weight_log / diet_plans / dish_feedback 四张表
- [ ] **Step 2.2** 运行测试确认失败（模块不存在）
- [ ] **Step 2.3** 实现 `sqlite.ts`：导出 `openDb(path)`，内部建四张表（字段以设计文档第 5 节为准：profile 单行表；weight_log(date,weight_kg)；diet_plans(date,total_kcal,protein_g,carb_g,fat_g,meals_json,source)；dish_feedback(dish_id,score)），并导出「文件库默认路径 = server/data/app.db」的便捷打开函数
- [ ] **Step 2.4** 运行测试通过
- [ ] **Step 2.5** Commit：`feat: SQLite 建表与连接`

## Task 3: 食材营养数据包 foods.json

**Files:**
- Create: `server/src/data/foods.json`、`server/src/data/load.ts`
- Test: `server/test/data/foods.test.ts`

- [ ] **Step 3.1** 整理数据：基于《中国食物成分表》公开数据，覆盖菜场常见食材 **约 150 种起步**（分 8 类：主食谷物 / 肉禽蛋 / 水产 / 豆制品 / 乳品 / 蔬菜 / 水果 / 油脂调味）。每条字段：id（拼音或英文 slug）、名称、类别、每100g 的 kcal / protein_g / carb_g / fat_g、常用单位（如鸡蛋按"个"≈50g）换算表
- [ ] **Step 3.2** 写失败测试（数据校验测试）：每条字段齐全且为非负数、id 唯一、8 个类别均有覆盖、抽查 5 个已知食材数值在合理区间（如鸡胸肉蛋白 ≥ 20g/100g）
- [ ] **Step 3.3** 实现 `load.ts`：导出 `loadFoods()`（读 JSON 并按 id 建 Map）与 `getFood(id)`
- [ ] **Step 3.4** 测试通过
- [ ] **Step 3.5** Commit：`feat: 食材营养数据包与加载器`

## Task 4: core/bmr.ts 热量与宏量计算

**Files:**
- Create: `server/src/core/bmr.ts`（同时定义并导出 Profile、DietStructure 等类型）
- Test: `server/test/core/bmr.test.ts`

- [ ] **Step 4.1** 写失败测试，至少覆盖：
  - Mifflin-St Jeor 已知案例：男 30岁/175cm/80kg → BMR=1780；女 30岁/165cm/60kg → BMR=1321
  - TDEE = BMR×活动系数（1.2/1.375/1.55 三档）
  - 目标热量 = TDEE−缺口（300~500 可调）
  - 宏量分配：按内置结构表（均衡 30/40/30、高蛋白 40/30/30、低碳 40/20/40、维持 20/50/30）换算克数（蛋白/碳水 4 kcal/g，脂肪 9 kcal/g），比例加总=100%
  - 蛋白质下限保护：计算结果蛋白 < 1.6g/kg 时强制抬到区间（1.6~2.0，默认 1.8），从脂肪/碳水按比例回扣热量
  - 自定义比例（用户拖滑块）与非法输入（比例和≠100%）抛错
- [ ] **Step 4.2** 运行测试确认失败
- [ ] **Step 4.3** 实现 `calcBmr / calcTdee / calcDailyTarget / calcMacros` 四个纯函数（无 IO）
- [ ] **Step 4.4** 测试通过
- [ ] **Step 4.5** Commit：`feat: BMR/TDEE/宏量计算核心`

## Task 5: core/mealSplit.ts 餐次分配

**Files:**
- Create: `server/src/core/mealSplit.ts`
- Test: `server/test/core/mealSplit.test.ts`

- [ ] **Step 5.1** 写失败测试，覆盖：
  - 16-8 模式：两正餐+可选训练加餐，比例 45/45/10（无加餐则 50/50），各餐热量/宏量=总目标×比例，加总=全天
  - 正常三餐：30/40/30；训练日加餐从总热量扣 10~15%（默认 12%），扣减后三餐按 30/40/30 重分配，加总仍=全天
  - 每餐输出含热量与三大宏量目标区间（区间=目标±10%）
  - 边界：极小热量目标（1200 kcal）不出现负数或 0 热量餐
- [ ] **Step 5.2** 运行确认失败
- [ ] **Step 5.3** 实现 `splitMeals(dailyTarget, mode, hasTraining)`，返回各餐次 `MealTarget[]`（含类型标签：breakfast/lunch/dinner/snack）
- [ ] **Step 5.4** 测试通过
- [ ] **Step 5.5** Commit：`feat: 餐次分配（16-8/三餐/训练加餐）`

## Task 6: core/nutrition.ts 配料营养汇总

**Files:**
- Create: `server/src/core/nutrition.ts`
- Test: `server/test/core/nutrition.test.ts`

- [ ] **Step 6.1** 写失败测试：单配料按克数换算（番茄 200g → 数值×2）；多配料菜=各配料之和；按"个"等单位换算（鸡蛋 2 个）；未知食材 id 抛出明确错误；结果四舍五入到 0.1g
- [ ] **Step 6.2** 确认失败
- [ ] **Step 6.3** 实现 `calcNutrition(ingredients: {foodId, amount, unit}[]) → {kcal, protein_g, carb_g, fat_g}`（食材数据以参数传入，保持纯函数）
- [ ] **Step 6.4** 测试通过
- [ ] **Step 6.5** Commit：`feat: 配料营养汇总`

## Task 7: profile/weight 仓储与路由

**Files:**
- Create: `server/src/db/repos/profileRepo.ts`、`server/src/db/repos/weightRepo.ts`、`server/src/routes/profile.ts`
- Test: `server/test/routes/profile.test.ts`

- [ ] **Step 7.1** 写失败集成测试（内存库 + fastify.inject）：GET /api/profile 首次返回 null；PUT 保存档案（zod 校验：性别/生日/身高/活动系数/饮食模式/饮食结构）；POST /api/profile/weight 记录体重后 GET 能查到最新体重与体重列表
- [ ] **Step 7.2** 确认失败
- [ ] **Step 7.3** 实现两个 repo（profile 单行读写、weight_log 追加与按日期倒序查询）与路由（薄层，只校验+调 repo；GET /api/profile/target 额外返回用最新体重算出的今日目标：热量+三大宏量+各餐次分配，即串联 Task 4/5）
- [ ] **Step 7.4** 测试通过
- [ ] **Step 7.5** Commit：`feat: 档案与体重 API`

## Task 8: 前端 uni-app 脚手架与 API 层

**Files:**
- Create: `fitness-diet/client/`（uni-app Vue3+TS 模板，H5 平台）、`client/src/api/request.ts`、`client/src/api/profile.ts`、`client/src/stores/profile.ts`

- [ ] **Step 8.1** 用官方 CLI 创建 uni-app Vue3+TS 项目（默认模板 + vite），验证 `npm run dev:h5` 能打开 H5 页
- [ ] **Step 8.2** 实现 `request.ts`：基于 uni.request 封装，baseURL 读环境变量（dev 指向 localhost:3000），统一错误提示
- [ ] **Step 8.3** 实现 `api/profile.ts`：getProfile / saveProfile / addWeight / getTarget 四个函数
- [ ] **Step 8.4** 实现 Pinia `stores/profile.ts`：档案与今日目标状态、加载 action
- [ ] **Step 8.5** 手动验证：H5 页控制台能打印 getTarget 返回
- [ ] **Step 8.6** Commit：`feat: 前端脚手架与档案 API 层`

## Task 9: 今日页（M1 版）+ 档案页

**Files:**
- Create: `client/src/pages/today/today.vue`、`client/src/pages/profile/profile.vue`、`client/src/components/MacroRing.vue`
- Modify: `client/src/pages.json`（注册页面与 tabBar：今日/档案两项）

- [ ] **Step 9.1** 今日页：显示今日目标热量大数字 + MacroRing 三环（蛋白/碳水/脂肪目标克数）；无档案时引导去档案页
- [ ] **Step 9.2** 档案页：表单录入性别/生日/身高/活动系数/饮食模式/饮食结构/每日缺口；体重录入区（今日体重输入 + 历史列表）
- [ ] **Step 9.3** 联调验收（浏览器实测）：录入档案 → 今日页显示目标；改体重再提交 → 今日页热量数字变化。**这是 M1 验收标准**
- [ ] **Step 9.4** Commit：`feat: M1 今日目标与档案页面`

---

# 里程碑 M2：食谱生成（核心）

**验收标准：一键生成全天食谱，连续 7 天生成菜品不重复，各餐营养落区间。**

## Task 10: 菜谱数据包 dishes.json

**Files:**
- Create: `server/src/data/dishes.json`
- Modify: `server/src/data/load.ts`（加载 dishes、按标签/角色索引）
- Test: `server/test/data/dishes.test.ts`

- [ ] **Step 10.1** 整理数据：**≥80 道家常菜起步**，每道含：id、菜名、餐次标签（可多选：breakfast/lunch/dinner/snack）、组合角色（staple 主食/protein 蛋白/vegetable 蔬菜/simple 纯食材项）、配料列表（foodId+克数/单位）、做法简述（1~2 句）、口味标签。要求：每类角色每餐次至少 8 道候选；simple 类覆盖水煮蛋/牛奶/即食鸡胸/蛋白粉等兜底项
- [ ] **Step 10.2** 写失败测试：字段完整、id 唯一、**每条配料 foodId 必须存在于 foods.json**（联动校验）、每个"角色×餐次"组合候选数达标、simple 类必有
- [ ] **Step 10.3** 实现加载与索引；测试通过
- [ ] **Step 10.4** Commit：`feat: 家常菜谱数据包`

## Task 11: planner 候选过滤与打分

**Files:**
- Create: `server/src/core/planner.ts`
- Test: `server/test/core/planner.test.ts`

- [ ] **Step 11.1** 写失败测试：候选过滤（按餐次标签+角色，排除"不吃"反馈的菜）；打分函数单独可测——构造已知菜与目标，断言营养贴合度分量（加入后偏差越小分越高）、多样性分量（3 天内用过权重×0.1、7 天内×0.4、食材重合度高降权）、偏好分量（喜欢+、一般 0、不吃→直接过滤）
- [ ] **Step 11.2** 确认失败
- [ ] **Step 11.3** 实现 `filterCandidates` 与 `scoreDish`（纯函数：菜、目标、近期历史、偏好表以参数传入）
- [ ] **Step 11.4** 测试通过
- [ ] **Step 11.5** Commit：`feat: planner 候选过滤与打分`

## Task 12: planner 组合算法（贪心+回溯+兜底）

**Files:**
- Modify: `server/src/core/planner.ts`
- Test: `server/test/core/planner.test.ts`（追加）

- [ ] **Step 12.1** 写失败测试：
  - 单餐生成：按 角色 staple+protein+vegetable 挑菜，整餐热量落在目标±10% 区间
  - 全天生成：逐餐次填菜，各餐营养落区间、蛋白全天达标
  - 回溯：构造菜库使首选组合超区间，断言换菜后仍收敛
  - 兜底：菜库无法满足时自动追加 simple 项补缺口，且结果带 `degraded: true` 标记
  - 极端输入（目标 1200kcal / 3500kcal）不崩溃、必有输出
  - **连续 7 天生成（同目标），任一菜品出现次数 ≤ 2**（核心不重复验收）
- [ ] **Step 12.2** 确认失败
- [ ] **Step 12.3** 实现 `generateDay(mealTargets, dishes, history, feedback)`：每餐贪心选分最高组合，超区间回溯（限制回溯深度防指数爆炸），失败转兜底路径
- [ ] **Step 12.4** 测试通过
- [ ] **Step 12.5** Commit：`feat: 食谱组合算法`

## Task 13: planService 与食谱 API

**Files:**
- Create: `server/src/services/planService.ts`、`server/src/db/repos/planRepo.ts`
- Modify: `server/src/routes/plan.ts`（新建并注册）
- Test: `server/test/routes/plan.test.ts`

- [ ] **Step 13.1** 写失败集成测试：POST /api/plan/generate {date} → 读档案→算目标（Task 4/5）→ 取近 7 天历史（planRepo 查询）→ planner 生成 → 存 diet_plans → 返回完整结果（各餐菜品+配料克数+每餐实际营养 vs 目标+degraded 标记+生成方式）；同日重复 generate = 覆盖重生成；GET /api/plan/:date 查询；POST /api/plan/:date/reroll-dish {mealIndex, dishIndex} 重抽单道菜（排除该菜自身、保持整餐区间约束）
- [ ] **Step 13.2** 确认失败
- [ ] **Step 13.3** 实现 planRepo（按日期存取）与 planService（编排），路由注册到 index.ts
- [ ] **Step 13.4** 测试通过
- [ ] **Step 13.5** Commit：`feat: 每日食谱生成 API`

## Task 14: 前端今日页完整版 + 历史页

**Files:**
- Create: `client/src/components/MealCard.vue`、`client/src/pages/history/history.vue`、`client/src/api/plan.ts`、`client/src/stores/plan.ts`
- Modify: `client/src/pages/today/today.vue`、`client/src/pages.json`

- [ ] **Step 14.1** api/plan.ts：generatePlan / getPlan / rerollDish；stores/plan.ts 状态管理
- [ ] **Step 14.2** 今日页完整版：目标环 + 各餐 MealCard（菜名、配料克数、本餐营养 vs 目标）+「生成今日食谱」按钮 + 每道菜「换一道」+ degraded 提示条
- [ ] **Step 14.3** 历史页：按日期列表查看历史食谱与当日营养汇总
- [ ] **Step 14.4** 联调验收（浏览器实测 M2 验收标准）：连续点 7 天日期分别生成，检查菜品不重复；换一道立即生效且整餐营养仍在区间
- [ ] **Step 14.5** Commit：`feat: M2 食谱生成前端`

---

# 里程碑 M3：AI 增强

**验收标准：给 3 样食材能出可计算的菜谱；AI 不可用时纯算法兜底。**

## Task 15: LLM 适配器

**Files:**
- Create: `server/src/ai/llm.ts`
- Test: `server/test/ai/llm.test.ts`（用注入的假 fetch，不发真实请求）

- [ ] **Step 15.1** 写失败测试：调用 OpenAI 兼容 chat/completions（可注入 fetch mock）；响应解析为 JSON（含 markdown 代码块剥离）；zod schema 校验失败时自动带错误信息重试一次；两次仍失败抛 LLMError；请求体含 temperature 与 response_format json_object（若供应商支持）；超时（默认 30s）中断
- [ ] **Step 15.2** 确认失败
- [ ] **Step 15.3** 实现 `callLlm(prompt, schema, opts)` 泛型函数：读 .env 配置、注入式 fetch、JSON 提取→zod 解析→失败重试
- [ ] **Step 15.4** 测试通过
- [ ] **Step 15.5** Commit：`feat: LLM 适配器`

## Task 16: AI 看料做菜（chefService + chef 路由）

**Files:**
- Create: `server/src/services/chefService.ts`、`server/src/routes/chef.ts`
- Test: `server/test/routes/chef.test.ts`（LLM 用假实现注入）

- [ ] **Step 16.1** 写失败集成测试：POST /api/chef/cook {foodIds: [...]} → prompt 含所选食材清单与"只准用这些+基础调味"约束 → LLM 返回 1~3 道菜（菜名+配料 foodId+克数，zod 定义 AI 输出 schema）→ 后端用 nutrition.ts 算真实营养 → 返回每道菜营养预览；LLM 返回的 foodId 不在食材表 → 重试一次 → 仍失败返回明确错误码，**不落库**
- [ ] **Step 16.2** 确认失败
- [ ] **Step 16.3** 实现 chefService（组装 prompt、调 callLlm、校验配料可解析、算营养），路由注册；另加 POST /api/chef/save-dish：把预览确认后的 AI 菜存入菜谱库（写入 dishes.json 的用户扩展文件 `dishes.user.json`，load.ts 合并加载，避免覆盖内置数据）
- [ ] **Step 16.4** 测试通过
- [ ] **Step 16.5** Commit：`feat: AI 看料做菜`

## Task 17: AI 换一道（替代推荐）+ AI 兜底生成

**Files:**
- Modify: `server/src/services/chefService.ts`、`server/src/routes/chef.ts`、`server/src/services/planService.ts`

- [ ] **Step 17.1** 写失败测试：POST /api/chef/replace-dish {date, mealIndex, dishIndex} → LLM 基于被替换菜的营养特征与整餐剩余目标给 1 个替代（同样返回配料可计算）→ 返回营养对比；planService 增加 AI 兜底路径：planner degraded 且用户开启 AI 时，LLM 生成食谱草稿→后端逐菜校验配料与营养→达标替换、不达标自动按比例缩放克数再校验一次
- [ ] **Step 17.2** 确认失败
- [ ] **Step 17.3** 实现两条路径；测试通过
- [ ] **Step 17.4** Commit：`feat: AI 换菜与兜底生成`

## Task 18: 前端 AI 厨师页 + 降级体验

**Files:**
- Create: `client/src/pages/chef/chef.vue`、`client/src/api/chef.ts`
- Modify: `client/src/pages.json`、`client/src/pages/today/today.vue`（换一道增加"AI 换"入口；AI 失败提示+一键纯算法降级按钮）

- [ ] **Step 18.1** AI 厨师页：食材多选（按 8 类分组，来自后端提供的食材列表接口 GET /api/foods）→ 「看看能做什么」→ 菜卡（配料+真实营养）→ 「存入我的菜谱」
- [ ] **Step 18.2** 今日页：菜品菜单增加「AI 换一道」，AI 调用失败时 toast + 降级按钮（走纯算法 reroll）
- [ ] **Step 18.3** 联调验收（M3 标准）：选鸡胸/西兰花/米饭 3 样 → 返回可计算菜谱 → 存入后出现在后续生成候选中；断网/无 Key 场景纯算法仍全流程可用
- [ ] **Step 18.4** Commit：`feat: M3 AI 厨师前端`

---

# 里程碑 M4：打磨

**验收标准：偏好影响生成结果；趋势可视化；结构切换有提醒。**

## Task 19: 菜品偏好反馈闭环

**Files:**
- Create: `server/src/db/repos/feedbackRepo.ts`
- Modify: `server/src/routes/plan.ts`（新增 POST /api/feedback）、`client/src/pages/today/today.vue`（菜品卡长按/菜单：喜欢/不吃/一般）

- [ ] **Step 19.1** 测试：反馈接口存取；planner 生成时传入 feedback 后「不吃」的菜永不出现、「喜欢」的菜加权（已有单测基础上补集成验证）
- [ ] **Step 19.2** 实现接口与前端交互；测试通过
- [ ] **Step 19.3** Commit：`feat: 菜品偏好反馈`

## Task 20: 体重趋势图与目标演变

**Files:**
- Create: `client/src/components/WeightChart.vue`
- Modify: `client/src/pages/profile/profile.vue`

- [ ] **Step 20.1** WeightChart 组件（canvas 或引入轻量图表库，uni-app 兼容）：近 30/90 天体重曲线 + 目标热量随体重变化的第二曲线
- [ ] **Step 20.2** 后端补 GET /api/profile/weight/history?days=（如无）
- [ ] **Step 20.3** 浏览器实测渲染正确；Commit：`feat: 体重趋势图`

## Task 21: 饮食结构阶段提醒

**Files:**
- Create: `server/src/core/stageRule.ts`
- Test: `server/test/core/stageRule.test.ts`
- Modify: `server/src/services/planService.ts`、`client/src/pages/today/today.vue`

- [ ] **Step 21.1** 测试：输入体重史+目标体重，判断阶段（减脂期/接近目标/达标），给出结构切换建议（如达标后建议「高蛋白减脂」→「均衡维持」）；规则：距目标 >5kg 维持现结构、2~5kg 建议、<2kg 强烈建议
- [ ] **Step 21.2** 实现纯函数 `suggestStage(weightHistory, goal)`；生成食谱返回体附 suggestion 字段（只提醒）
- [ ] **Step 21.3** 前端今日页顶部非阻断提示条 +「一键切换」按钮（改 profile 结构后重算）
- [ ] **Step 21.4** 测试与联调通过；Commit：`feat: 饮食结构阶段提醒`

## Task 22: M4 收尾与全量回归

- [ ] **Step 22.1** 全量 `npm test`（后端）通过；数据包校验测试通过
- [ ] **Step 22.2** 浏览器走全流程：建档→记体重→生成→换菜→AI 做菜→反馈→历史→趋势图
- [ ] **Step 22.3** 修复发现的问题，各自 commit；最终打 tag `v0.1.0`
- [ ] **Step 22.4** 更新 README（启动方式、.env 配置、备份说明）

---

# M5（远期，不在本计划内）

uni-app 编译微信小程序：`npm run dev:mp-weixin`，开发者工具导入 dist 目录，勾选「不校验合法域名」联调 localhost；上线需 HTTPS 备案域名。

---

## 自审记录

- **Spec 覆盖检查**：设计文档第 3 节架构→Task 1/2/8；4.1 热量计算→Task 4；4.2 饮食结构→Task 4/21；4.3 餐次分配→Task 5；4.4 组合算法→Task 10~12；4.5 AI 三入口→Task 15~17；第 5 节数据模型→Task 2/3/10；第 6 节文件结构→各任务 Files 与设计一致；第 7 节 API→Task 7/13/16/17/19/20；第 8 节错误处理→Task 15/16/18；第 9 节测试策略→各任务 TDD 步骤 + Task 22 回归。无遗漏。
- **占位符扫描**：无 TBD/TODO；无"适当处理"类含糊表述，每步均有明确产出与验证方式。
- **一致性检查**：表名（profile/weight_log/diet_plans/dish_feedback）、函数命名（calcBmr/splitMeals/generateDay/callLlm）、文件路径在各任务间一致；dishes.user.json 机制在 Task 16 定义、Task 18 前端引用一致。
