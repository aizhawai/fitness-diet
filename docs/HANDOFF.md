# 交接归档 — 健身减脂饮食管理

> 归档时间：2026-10-15
> 状态：**M1~M4 全部任务已完成**。后端 399 测试全绿；前端 7 个页面全部浏览器实测通过。
> 分支：未建分支，全部提交在 main（13 个 commit）
> 剩余：配 LLM Key 后验真实 AI 路径、可选的小程序构建、全流程回归打 tag

---

## 一、当前状态一句话

**实施计划的 M1~M4 全部做完**。今日食谱（M2）与 AI 增强（M3）之外，M1 的验收标准「改体重目标热量立刻变」已在真实浏览器验证通过。剩下的都是锦上添花：配 Key 验真实 AI、可选修小程序构建、跑一次全流程回归打 tag。

---

## 二、完成度对照

### 后端（全部完成 ✅）

| 里程碑 | 任务 | 状态 | 关键产物 |
|---|---|---|---|
| M1 | 1/2/3/4/5/6/7 | ✅ | 工程底座、`node:sqlite` 四表、233 种食材、BMR/TDEE/宏量、餐次分配、配料汇总、档案体重 API |
| M2 | 10/11/12/13 | ✅ | 164 道菜谱、planner 组合算法、食谱生成 API |
| M3 | 15/16/17 | ✅ | LLM 适配器、看料做菜、AI 换一道、AI 兜底 |
| M4 | 19/21 | ✅ | 偏好反馈 API、阶段规则 + 返回体接线 |
| M4 | 22.4 | ✅ | README + 本归档 |

### 前端（全部完成 ✅）

| 页面/组件 | 任务 | 状态 | 浏览器实测 |
|---|---|---|---|
| 今日页（M1 目标数字） | 8/9 | ✅ | ✅ 改体重 1963→1895 kcal |
| 今日页（完整版 + 换菜） | 14 | ✅ | ✅ 生成/换一道/降级条 |
| 档案页 + 体重录入 | 9 | ✅ | ✅ |
| 历史页 | 14 | ✅ | ✅ 列表/展开/加载更多 |
| 体重趋势图 | 20 | ✅ | ✅ 双曲线 canvas，30/90 天切换 |
| AI 厨师页 | 18 | ✅ | ✅ 233 食材分组多选、`NOT_CONFIGURED` 降级提示 |
| 今日页偏好反馈 | 19 | ✅ | ✅ 四选操作条、角标刷新回填 |
| MacroRing | 9 | ✅ | ✅ 修了与说明文字重叠 |

---

## 三、已验证 / 未验证（务必区分）

### 已实测（真实浏览器 + 真实后端 + 真实数据）

| 验收项 | 结果 |
|---|---|
| M1：改体重 → 目标热量立刻变 | 80kg→1963 kcal，75kg→**1895 kcal**，页面显示一致 |
| M2：一键生成全天食谱 | 1968 kcal，607/765/596，**三餐全部达标** |
| M2：连续 7 天不重复 | 55 道菜**零重复**（要求 ≤2） |
| M2：换一道 | 牛肉干→清蒸鲅鱼，该餐 763→719，其余菜未动 |
| M3：AI 不可用时产品仍可用 | `NOT_CONFIGURED` 提示友好、**不显示无效的重试按钮** |
| M3：AI 换菜失败不破坏原计划 | 失败后全天 2029 kcal、三道菜名一字未变 |
| M4：不吃闭环 | 标记后连续 7 天**一次未出现**，各餐仍全达标；角标刷新后仍在 |
| M4：阶段建议接线 | 距 1kg → `nearing`/`strong`/建议切均衡减脂 |
| 数据包质量 | 233 食材 / 164 菜谱，16 组合每组 ≥8，foodId/unit 零非法，热量全落区间 |

### 未验证 / 有缺口（重要）

1. **AI 成功路径完全没跑过** —— 本机没有 LLM Key，后端只会回 `NOT_CONFIGURED`。以下全部**只做了代码走查**：
   - `POST /api/chef/cook` 出菜卡渲染、配料中文名+克数、营养四栏
   - `POST /api/chef/save-dish` 实际往返
   - `LLM_FAILED`(timeout/network/schema)、`UNRESOLVABLE_INGREDIENTS`、`EMPTY`、`UNKNOWN_FOOD`、离线这几条分支的真实返回形状
   - `UNKNOWN_DISH` 反馈分支
   - 真实 prompt 效果、超时表现、模型返回质量
2. **`mp-weixin` 构建失败**（M5 远期，不在计划范围）
3. **前端未做小程序端实测**
4. **长按（`@longpress`）未实测**，只测了点 `⋯`
5. 历史页空态、降级条、阶段建议条的**真实数据**渲染未亲眼看到（当时后端是旧版本，字段还不存在）
6. 分页加载只用小页长验过，没造过多天真实数据

---

## 四、踩过的坑与根因（这部分最有价值）

### 1. 🔴 白屏：Vite dev server 不失效旧进程

**症状**：页面完全白屏，`TypeError: Cannot assign to read only property '_'`。

**根因**：改 Vue 版本后没重启 dev server。**Vite 默认不 watch `node_modules`**，旧进程继续从内存 transform 缓存里发旧版 `@vue/shared`（3.5.44），而 uni 运行时是 3.4.21 → 混版 → Vue 的 `initSlots` 把 `_` 定义为 non-writable，随后 `normalizeChildren` 又要写 `children._` → 抛错 → 渲染中断。

**定位方法**（可复用）：把坏掉的和正常的两个 server 所有模块抓下来**逐字节 diff**，找到唯一差异；再反向验证——把 alias 指向坏版本立刻复现。

**已加固**：`package.json` 加 `predev:h5` 清 `node_modules/.vite`。

> **纪律：改任何依赖版本 + `npm install` 之后，必须重启 dev server。**

### 2. better-sqlite3 在 Node 24 装不上

无预编译包 → 回退源码编译 → 缺 Visual Studio → 失败。
**解法**：改用 Node 24 内置 `node:sqlite`（SQLite 3.51.3），零原生依赖。

> ⚠️ 两个特性：不能绑定 `undefined`（可空字段必须显式传 `null`）；返回行是 null-prototype 对象（测试用 `toEqual` 不能用 `toStrictEqual`）。

### 3. uni-app 的 Vue 版本必须钉死

`@dcloudio/*` 全部**精确**依赖 `3.4.21`。`vue` 若写成 `^3.4.21` 会解析到 3.5.44，直接版本撕裂。
**已在 `client/package.json` 用 `overrides` 把整条 @vue/* 树钉在 3.4.21。**

### 4. 沙箱权限边界

| 被拦的操作 | 绕行方式 |
|---|---|
| `npx degit` 拉官方模板 | 手写 uni-app 工程 + 固定版本 |
| `npm install`（部分） | 用户手动 `! npm install` |
| `taskkill` 非本会话创建的进程 | 改用别的端口（`PORT=3001` / `PORT=5274`） |
| 写 `/tmp` 下的固定路径 | 改用项目内路径或管道 |
| 写共享的 `server/data/app.db` | 用 `DATA_DIR` 环境变量指向临时目录 |

> 本轮验证就是这么绕开旧进程的：`PORT=3001` 起最新代码后端 + `API_PROXY_TARGET` 让 vite 代理过去（这两个值已改成读环境变量，默认仍是 3000/5173）。

### 5. 内存吃紧，进程被系统回收

同时跑「后端 + 前端 dev server + 浏览器」会被 OOM killer 干掉。
**并行开发时一次只起一个进程，验证完立刻关。**

---

## 五、算法上的三个关键决定（planner）

1. **蛋白槽永不跳过**。极低热量目标时，宁可让整餐超出 `kcalMax` 并标 `degraded`，也不接受「缺蛋白却标达标」的假达标——用户减的正是蛋白。

2. **额外主食槽排在最后**。大餐次会按 `LARGE_MEAL_KCAL` 追加主食槽，但**必须排在最后**：若插在蛋白前面，贪心会先吃两道主食再硬塞蛋白，把整餐顶出上限。

3. **`LARGE_MEAL_KCAL` 从 780 降到 500**。原值下 `moderate` 档（2264 kcal）早餐目标 679，7 天里 6 天**误标 degraded**——根因是早餐候选池浅（蔬菜只有 10 道），多样性降权把高热量候选压下去后剩余组合够不到 `kcalMin`，被迫走兜底。降到 500 后 7 天全达标零降级。

> 改 planner 后**必须**跑 `npx tsx scripts/planner-smoke.ts` 与 `scripts/breakfast-repro.ts`。

---

## 六、疑问与待决策

### 需要你拍板的

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | **LLM 用哪家？** 需要 `LLM_API_KEY`（DeepSeek / Kimi / 通义等 OpenAI 兼容接口）填进 `server/.env` | **优先级最高** —— 这是唯一还没验证的主功能路径。不配也能正常用（纯算法） |
| 2 | **mp-weixin 构建失败要不要修？** rollup 找不到 Vue 内部导出 `isInSSRComponentSetup`，属 uni 官方包与 Vue 的版本契约问题 | 不急，M5 不在本期；但真要上小程序这是第一道坎 |
| 3 | **「换一道」是确定性的**（同一份计划重复换同一槽位得到同一道菜） | 想「每次换一个」需引入随机源，会牺牲可复现性。要不要？ |
| 4 | **1200 kcal 下限时晚餐会 degraded**（菜库最小组合已接近区间上限） | 根治要补一批**小份菜**，尤其早餐素菜只有 10 道、池子太浅。值得补 |
| 5 | **AI 换出来的菜不在菜谱库里**，所以①之后算法换不回来 ②**用户没法评价它**（`/api/feedback` 要求 dishId 在菜库中） | 前端已写友好提示，但根因在后端/产品规则：要么 AI 换菜成功时自动 `saveCookedDish`，要么明确「AI 菜不可评价」。**建议自动入库** |
| 6 | **前端 `api/chef.ts` 自带了一个 `codeRequest()`**，没复用 `request.ts` 的 `request()` | 因为后者抛的 `ApiError` 取不到业务 `code` 字段，而按错误码分流正是本项目重点。**最干净的收口**：给 `request.ts` 的 `ApiError` 补 `code`/`llmKind`/`missingIds` 三个字段，然后改回复用 |

### 技术债

- `app.ts` 里 `chefRoutes` 不接 db，换菜接口用**懒加载 `openDefaultDb()`**，生产下会有两个数据库连接（WAL 下安全，但最好统一）
- `localDate` / `ageOf` 在 `planService` 与 `routes/profile` 各有一份副本，建议抽到 `core/date.ts`
- 反馈路由挂在 `planRoutes` 里注册（当时 `app.ts` 有并行任务在动）。以后若有人在 `app.ts` 里再注册 `feedbackRoutes`，Fastify 会因重复路由报错 —— 要挪的话删掉 `plan.ts` 里那行 `await feedbackRoutes(app, opts)`
- 菜品操作条渲染在 `MealCard` 卡片**外部**（因为当时 MealCard 在禁改名单里）。若想长在卡内，需放开 `MealCard.vue` 加 2 prop + 2 emit，是很小的改动
- 前端无测试脚手架，只有 typecheck + 浏览器实测

---

## 七、环境残留（下次开工先处理）

```
taskkill /PID 28420        # 5274 端口的临时 dev server（验证 AI 厨师页时起的）
taskkill /PID 17272 /F     # 3000 端口的旧后端（Task 19 之前的代码版本）
```

- **3000**：PID 17272 —— 旧代码后端，一直被它占着，导致前端验证长期对着旧 API
- **3001**：最新代码后端（`DATA_DIR` 指向临时目录，测试反馈都写在那里，主库 `app.db` 干净：1 条计划 + 1 条体重）
- **5173**：PID 45764，本项目 dev server
- **5274**：PID 28420，临时 dev server

---

## 八、续做步骤

```bash
# 1. 清理残留进程
taskkill /PID 28420
taskkill /PID 17272 /F

# 2. 起后端（最新代码）
cd server && npx tsx src/index.ts          # → localhost:3000

# 3. 起前端
cd client && npm run dev:h5                 # → localhost:5173

# 4. 全量回归
cd server && npx vitest run && npx tsc --noEmit
cd client && npm run typecheck && npm run build:h5
cd server && npx tsx scripts/planner-smoke.ts   # 真实数据算法体检

# 5. 打 tag
git tag v0.1.0
```

**待办清单**（按优先级）：
- [ ] 配 `server/.env` 的 LLM Key，验真实 AI 路径（看料做菜 / 存菜谱 / AI 换菜 / 兜底）
- [ ] 重启后端后做一次**完整前后端联调**（现在的验证是绕开旧进程做的）
- [ ] 跑一次全流程回归：建档→记体重→生成→换菜→AI 做菜→反馈→历史→趋势图，打 tag v0.1.0
- [ ] 视决策补一批小份菜到菜谱库（治 1200 kcal 退化 + 加深早餐池）
- [ ] 视决策处理疑问 5（AI 菜入库）与疑问 6（ApiError 补字段收口）

---

## 九、核心设计不变式（改动时别破坏）

1. **`core/` 必须是纯函数** —— 不 import db / fs / 网络 / fastify，菜谱与历史一律以参数传入
2. **AI 只输出结构化 JSON（菜名 + 配料），营养数字一律后端算** —— AI schema 里不许有营养字段
3. **产品永远可用** —— AI 挂了静默降级纯算法；算法凑不出达标组合时用纯食材项兜底并如实标 `degraded`
4. **宁可如实报降级，不做假达标**（蛋白槽永不跳过就是这条的体现）
5. **确定性** —— 同输入必须同输出，不用 `Math.random()`，用输入 id 的稳定哈希做 tie-break
