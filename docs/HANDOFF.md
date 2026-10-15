# 交接归档 — 健身减脂饮食管理

> 归档时间：2026-10-15（第二次更新：接入 MiniMax / Anthropic 协议）
> 状态：**M1~M4 全部任务已完成**。后端 430 测试全绿；前端 7 个页面全部浏览器实测通过。
> 分支：`master` 冻结在已验证基线；AI 协议适配在 `feat/anthropic-llm-protocol`（**尚未合并**）
> 剩余：合并 AI 分支、可选的小程序构建、全流程回归打 tag

---

## 一、当前状态一句话

**实施计划的 M1~M4 全部做完**，并且**真实 AI 路径已经跑通**（2026-10-15 接入 MiniMax，走 Anthropic 协议）。
`master` 保持为「随时可跑、已验证」的基线；后续改动一律先开分支，不直接落 master。

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

### 已实测（2026-10-15，接入 MiniMax 真实 Key）

用 `scripts/llm-smoke.ts` 与 API 直打（非浏览器），模型 `MiniMax-M3.1-Flash-Preview`：

| 验收项 | 结果 |
|---|---|
| Anthropic 协议端到端 | ✅ `POST /anthropic/v1/messages` 返回 200，适配器解析正确 |
| `LLM_EFFORT` 合法值 | ✅ 用**反向对照**确认（填乱值 → 400 并列出 `low/medium/high/xhigh/max`） |
| 🔴 thinking 块过滤 | ✅ 真实响应里 thinking 与 text **混排**，过滤逻辑生效 |
| AI 看料做菜 `chef/cook` | ✅ 6.5 秒，返回 2 道菜；AI 只给菜名/配料/做法，**营养四栏由后端算**（317 kcal / 42.7g 蛋白） |
| AI 自作主张补食材 | ✅ 它补了未提供的 `hua_sheng_you` / `shi_yan`，且都在食材表清单内 |
| 算法路径未受影响 | ✅ 三餐全达标、零降级（早餐 681/670，午餐 810/893，晚餐 687/669） |
| `UNKNOWN_FOOD` 分支 | ✅ 传错 foodId → 400 + `missingIds` |
| 超时降级 | ✅ 触发 `LLMError(timeout)` → `LLM_FAILED` + `llmKind`，不炸服务 |

### 未验证 / 有缺口（重要）

1. **AI 换一道 `replace-dish` 尚未跑通** —— 见下方「六·AI 接入实测踩的坑」，已定位原因并改了代码，但**改完还没实测复验**
2. **AI 兜底生成（`useAiFallback`）未跑过**
3. **`POST /api/chef/save-dish` 未实测**（会写共享的 `dishes.user.json`，故意没碰）
4. **`UNKNOWN_DISH` 反馈分支**未实测
5. **前端浏览器未验 AI 流程** —— 本轮验证全是 API 直打，AI 厨师页/换菜按钮的渲染未亲眼看到
6. **`mp-weixin` 构建失败**（M5 远期，不在计划范围）
7. **前端未做小程序端实测**
8. **长按（`@longpress`）未实测**，只测了点 `⋯`
9. 历史页空态、降级条、阶段建议条的**真实数据**渲染未亲眼看到（当时后端是旧版本，字段还不存在）
10. 分页加载只用小页长验过，没造过多天真实数据

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

### 18. 🔴 一键工具（2026-10-15 第三轮）

`setup.bat` / `start.bat` + `scripts/{setup,start}.mjs`，把「装依赖 → 建 .env → 起双服务 → 开浏览器 → 干净关闭」收成一次点击。

写它的时候踩到的四个坑，**每个都会在别的机器上复现**：

1. **`spawn EINVAL`**：Windows 上 `npm` 实际是 `npm.cmd`，Node 20.12+ 起不带 shell 直接 spawn 批处理文件会抛这个错。必须绕一层 `cmd.exe /c`。⚠️ 本机因为依赖早就装好、跳过了 install，**测不出来** —— 只有全新 clone 才会踩。
2. **端口探测漏判**：`isPortFree` 绑 `0.0.0.0` 会漏掉「只监听 `[::1]`」的程序，而 **vite 默认就只听 `[::1]`**。漏判后 vite 又会静默换端口，两边地址错位。现在三个地址（`0.0.0.0` / `127.0.0.1` / `::1`）都试，任一失败即判定占用。
3. **`process.on('exit')` 里 await 不住**：`void killChild(...)` 看着在清理，实际异步 `execFile` 还没跑完进程就退出了 → 留下孤儿。必须用 `spawnSync` 版本。（`SIGINT` 路径可以正常 await，所以只有强杀/关窗口这条兜底路径有洞。）
4. **`netstat -ano -p tcp` 在这台机器上无输出**（只输出一行乱码），只能用 `netstat -ano`。且匹配要认准「本地地址」列，否则会把连接误当监听。

配套：`client/vite.config.ts` 的 `strictPort` 由 `STRICT_PORT=1` 打开 —— 端口冲突时**大声失败**好过 vite 静默换端口。

---

## 五之二、AI 接入实测踩的坑（2026-10-15 新增）

### 6. 🔴 thinking 块与 text 块混排，取 `content[0].text` 必挂

MiniMax 的 Anthropic 响应里 `content` 是**块数组**，thinking 与 text 混排，且**即使不要求思考也会返回 thinking 块**。
若沿用 OpenAI 那套 `content[0].text` 的写法，会直接拿到 thinking 块的 `undefined` → parse 失败 → 白白重试两次 → 报 `LLM_FAILED`。

> **必须**按 `type === 'text'` 过滤，且把**所有** text 块拼起来（不能只取第一个）。

### 7. 🔴 思考 token 从 max_tokens 里扣，额度太小会「没有 text 块」

实测：换菜路径原本给 `max_tokens: 900`，配 `LLM_EFFORT` 后思考过程把额度吃光，返回里只剩 thinking 块。
**已做两件事**：① 把三个入口的 max_tokens 统一提到 2000，并抽成具名常量 + 注释说明原因；② 把 `LLM_EFFORT` 降到 `medium`。

> 教训：**JSON 本身只要几百 token，多出来的额度是留给思考的，不是浪费。** 别再往小调。

### 8. 🔴 判断顺序：截断必须排在「没有 text 块」前面

思考吃光额度时，`content` 里只剩 thinking 块 → 会命中「没有 text 块」分支 → `truncated` 没被置位 → **重试 prompt 里没有「精简输出」提示** → 第二次必然原样再失败。已调整顺序并补了单测。

### 9. 🔴 `callLlm` 的重试有个盲区（既有问题，本次顺带暴露）

`requestOnce` 抛出的**可重试**错误走 `continue` 分支，**跳过了追加修正说明**，等于盲重发同一份请求。
原先 `requestOnce` 只会抛网络/超时/http 类错误，所以从没踩到；加了「截断」这种 parse 类错误后才暴露。
已改为：内容类失败也落到统一的修正分支。（`buildCorrection` 里本来就写好了 http 重试的提示文案，说明原作者本意如此，只是被 `continue` 跳过了。）

### 10. ⚠️ `base_resp.status_code` 业务错误藏在 HTTP 200 里

MiniMax 会以 **HTTP 200** 返回带 `base_resp.status_code !== 0` 的信封。只看 HTTP 状态码会把失败当成功。
已归为 `LLMError('http')`，且**刻意不填 `status`** —— 业务码动辄几千，填进去会被 `isRetryable` 的 `>= 500` 判成服务端故障而白白重试。

### 11. 🔴 模型编造食材 id —— 根因是 prompt 漏了一整块，不是模型笨

实测模型给出了 `shou_mo_fan_zhong_fan`、`yan_shui_mao_dou` 这类不存在的 id（真实 id 是 `shou_mo_fan`）。

**根因**：`buildReplacePrompt` 的 `candidateLines` 只给了模型**菜的 id**（`shou_mo_fan_wo_tou` 这种），
JSON 模板却要求它填 **`foodId`（食材 id）** —— 模型从头到尾**没见过任何合法食材清单**，只能编。
`buildMealPrompt`（整餐兜底）更糟，**一个清单都没有**。只有出菜路径（`buildCookPrompt`）是对的，
因为那里的食材是用户勾选的、带真实 id。

已做三层修复（见「五之三」）。

### 12. ⚠️ `xhigh` 延迟极不稳定

同一模型同一路径，耗时在 **1.8 秒 ~ 43 秒**之间跳（43 秒那次直接撞穿 30 秒默认超时）。
所以 `LLM_TIMEOUT_MS` 这次直接设到 180000，并且默认超时仍保持 30s 不变（不配即行为不变）。

---

## 五之三、AI 结构化输出改造（2026-10-15 第二轮）

### 13. 🔴 三层防「编造 id」，缺一不可

| 层 | 做法 | 拦住什么 |
|---|---|---|
| 提示 | 按 role 从**真实菜谱**提取食材清单（33~54 种，enum 约 600B） | 让模型**看得见**能选什么 |
| 协议 | `tools` + **强制** `tool_choice`，`inputSchema.foodId` 写 `enum` | 让模型**结构上编不出来** |
| 校验 | zod `z.enum` 兜底 | 编了也**过不了** → 重试并告知合法集合 |

> 只做提示层不够（模型不保证遵守）；只做 zod 不够（重试时模型不知道合法集合，只能瞎猜）。
> **强制 `tool_choice` 很关键** —— 非强制时模型可能只回文字不调工具。

### 14. ⚠️ 食材清单按 role 取，别塞全部 233 种

实测各 role 真实用到的食材数：staple 52 / protein 54 / vegetable 44 / simple 33。
按 role 取：语义对（新菜必须同 role）、数据来自真实菜谱、enum 约 600 字节。
全量 233 种要 2.8KB —— 4~5 倍体积换不来任何好处。

### 15. ⚠️ 行为变更：换菜路径的非法 foodId 不再报 `UNRESOLVABLE_INGREDIENTS`

| | 之前 | 现在 |
|---|---|---|
| 模型给了非法 foodId | 直接 `UNRESOLVABLE_INGREDIENTS`（不重试） | 重试一次（告知合法集合）→ 仍失败才 `LLM_FAILED` + `llmKind=schema` |

**这是有意为之**：重试才是修复本身。代价是重试后仍失败时错误码从具体变笼统。
`UNRESOLVABLE_INGREDIENTS` 仍然保留给「单位换算不了」这类场景，以及**未受约束的出菜路径**。

### 16. ⚠️ 隐私：偏好与历史会离开本机

按需求给 AI 喂了「用户口味（不吃/一般/喜欢）」+「最近 4 天实际搭配」。
**这意味着饮食记录与偏好标记会被发到模型服务商（当前是 MiniMax）。**
出菜路径不涉及这些，只发用户勾选的食材。

### 17. ⚠️ 注入 `callLlmImpl` 会整个替换掉 `callLlm`

测试里注入假实现后，`callLlm` **内部的重试逻辑不会执行**。
断言「应该重试了一次」时别写在 service 层测试里 —— 那些用例本来就只调一次。

---

## 六、疑问与待决策

### 需要你拍板的

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | ~~LLM 用哪家~~ | ✅ 已定：**MiniMax**（`MiniMax-M3.1-Flash-Preview`），走 Anthropic 协议 |
| 2 | **mp-weixin 构建失败要不要修？** rollup 找不到 Vue 内部导出 `isInSSRComponentSetup`，属 uni 官方包与 Vue 的版本契约问题 | 不急，M5 不在本期；但真要上小程序这是第一道坎 |
| 3 | **「换一道」是确定性的**（同一份计划重复换同一槽位得到同一道菜） | 想「每次换一个」需引入随机源，会牺牲可复现性。要不要？ |
| 4 | **1200 kcal 下限时晚餐会 degraded**（菜库最小组合已接近区间上限） | 根治要补一批**小份菜**，尤其早餐素菜只有 10 道、池子太浅。值得补 |
| 5 | **AI 换出来的菜不在菜谱库里**，所以①之后算法换不回来 ②**用户没法评价它**（`/api/feedback` 要求 dishId 在菜库中） | 前端已写友好提示，但根因在后端/产品规则：要么 AI 换菜成功时自动 `saveCookedDish`，要么明确「AI 菜不可评价」。**建议自动入库** |
| 6 | **前端 `api/chef.ts` 自带了一个 `codeRequest()`**，没复用 `request.ts` 的 `request()` | 因为后者抛的 `ApiError` 取不到业务 `code` 字段，而按错误码分流正是本项目重点。**最干净的收口**：给 `request.ts` 的 `ApiError` 补 `code`/`llmKind`/`missingIds` 三个字段，然后改回复用 |
| 7 | ~~模型编造食材 id，换菜不自愈~~ | ✅ 已修：三层防线（真实食材清单 + 强制 tool_choice + z.enum），见五之三·13 |
| 8 | **隐私：偏好与历史发给第三方**（见五之三·16） | 你的饮食记录会到 MiniMax。功能上已按需求实现；要不要加个开关默认关闭，由你定 |

### 技术债

- `app.ts` 里 `chefRoutes` 不接 db，换菜接口用**懒加载 `openDefaultDb()`**，生产下会有两个数据库连接（WAL 下安全，但最好统一）
- `localDate` / `ageOf` 在 `planService` 与 `routes/profile` 各有一份副本，建议抽到 `core/date.ts`
- 反馈路由挂在 `planRoutes` 里注册（当时 `app.ts` 有并行任务在动）。以后若有人在 `app.ts` 里再注册 `feedbackRoutes`，Fastify 会因重复路由报错 —— 要挪的话删掉 `plan.ts` 里那行 `await feedbackRoutes(app, opts)`
- 菜品操作条渲染在 `MealCard` 卡片**外部**（因为当时 MealCard 在禁改名单里）。若想长在卡内，需放开 `MealCard.vue` 加 2 prop + 2 emit，是很小的改动
- 前端无测试脚手架，只有 typecheck + 浏览器实测

---

## 七、环境残留（下次开工先处理）

> ⚠️ 2026-10-15 更新：这一节基本作废了 ——
> **`start.bat` 会自己处理端口占用**（问你要不要杀），Ctrl+C 一次全停、不留孤儿。
> 下面只剩一条历史遗留：

```
taskkill /PID 39496 /F     # 一键工具写完之前留下的 vite 孤儿（当时 exit 处理器里 await 不住）
```

- **主库 `app.db` 仍是干净的**，本轮测试数据都在 `server/.e2e-data/`（已 gitignore）
- **`src/data/dishes.user.json` 里有 3 道 AI 菜**（浏览器里收藏的，已 gitignore）

---

## 八、续做步骤

```bash
# 1. 清理唯一的历史残留（见第七节）
taskkill /PID 39496 /F

# 2. 起服务 —— 双击 start.bat 就行，不用再敲下面这些
#    npm start
```

全量回归：
```bash
npm test                    # 后端 430 条
npm run typecheck           # 前后端一起
cd server && npx tsx scripts/planner-smoke.ts   # 真实数据算法体检
cd server && npx tsx scripts/llm-smoke.ts       # 🔴 会真调 LLM 接口（花钱）
```


**待办清单**（按优先级）：
- [ ] **决策疑问 7**（编造食材 id 的根治方案），修好后复验「AI 换一道」
- [ ] 前端浏览器验一遍 AI 流程（本轮全是 API 直打，页面渲染没亲眼看）
- [ ] 验 AI 兜底生成（`useAiFallback`）与 `save-dish`
- [ ] 合并 `feat/anthropic-llm-protocol` 回 master
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
