# 健身减脂饮食管理

本地跑的个人减脂饮食工具。按体重动态算每日热量与宏量，算法生成不重复的每日食谱，AI 做增强（看料做菜 / 换一道 / 兜底）。数据全部存本地 SQLite 文件。

> **当前版本：`v2`**（多用户数据隔离）。从另一台电脑拉最新代码：`git checkout v2 && git pull`。

> **需要 Node 24 或更高版本**（后端用了 Node 内置的 `node:sqlite`，22 及以下需要实验性 flag，装完也跑不起来）。

> 🔴 **准备部署到服务器之前，先看下面「已知限制」第一条。** 现在是纯昵称登录、没有密码，
> 昵称就是口令 —— 单机一个库时无所谓，多人共用一个库就等于所有人的数据公开。

## 核心设计

**计算与算法全在后端 `core/` 纯函数层** —— 不碰数据库、不碰网络，可独立单测。热量计算、宏量分配、食谱组合是产品心脏；换前端（网页 → 微信小程序）或加 AI，核心算法不动。

**AI 不参与营养计算。** AI 只输出结构化 JSON（菜名 + 配料表），营养数字一律由后端食材表按克数算 —— 从根上规避模型编数字。

**AI 也被约束在「真实数据」里。** 换菜与整餐兜底两条路径会把该角色真实菜谱用到的食材清单喂给模型，并用 `tools` 强制调用把 `foodId` 锁成枚举 —— 模型**结构上就编不出**不存在的食材 id（实测过：不给清单时它会编出 `shou_mo_fan_zhong_fan` 这种）。

**产品永远可用。** AI 挂了、超时、返回垃圾，都静默降级为纯算法生成；算法凑不出达标组合时用「纯食材项」兜底并如实标记 `degraded`。

**数据按人分开。** 档案、体重、食谱、菜品偏好、收藏的 AI 菜谱，全部挂在 `user_id` 下。
`v1` 时代这些表是**全局**的（`weight_log` 按 `date` 唯一、档案只有一行），
且有四处查询**没有任何 WHERE 条件** —— 也就是在有第二个用户之前就已经在泄露别人的数据了。
改造要点：

- 唯一约束一律改成 `(user_id, xxx)` 复合。SQLite 改不了 `UNIQUE`，四张表是整套重建的
- 迁移走 `PRAGMA user_version` 版本追踪，单用户老库整体一个事务搬过去，失败回滚、老库原样不动
- 鉴权在 **Fastify hook 里**做，不登录直接 401。不放在各路由里是故意的 ——
  「新增路由忘了鉴权」是个静默的漏洞，而且不会自己暴露
- 你收藏的 AI 菜谱以前存在**一个共享文件**里（`dishes.user.json`）加上模块级全局缓存，等于 A 收藏的菜 B 打开就能看见。现在搬进 `user_dishes` 表，全局缓存删掉了

## 快速开始

**Windows 上双击就行，三个文件：**

| 文件 | 什么时候用 | 做什么 |
|---|---|---|
| **`setup.bat`** | 换电脑、第一次跑 | 检查 Node 版本 → 装前后端依赖 → 建 `.env` → 引导填 LLM 配置 |
| **`start.bat`** | 日常启动 | 同时起后端与前端 → 等就绪 → 自动开浏览器 |
| **`stop.bat`** | 想停服务 | 不管启动窗口在哪，都能停干净 |

日常只需要 `start.bat` 一个。停服务有三种方式，随便挑：

- 在 `start.bat` 那个窗口按 **Ctrl+C**
- **直接关掉那个窗口** —— 服务会跟着停
- 窗口找不到了（最小化、切走了）→ **双击 `stop.bat`**

三种方式都会把后端、前端连同它们的子进程一起收掉，不留残留占用端口。

不想双击的话，仓库根目录也有 `npm` 脚本（等价）：

```bash
npm run setup     # 同 setup.bat
npm start         # 同 start.bat
npm stop          # 同 stop.bat
npm test          # 后端 526 条单测
npm run typecheck # 前后端一起
```

**端口被占用时会先问你**：显示是哪个 PID 占着，回 `y` 才杀、回 `N` 直接退出。
想固定用别的端口可以设环境变量 `SERVER_PORT` / `CLIENT_PORT`（前端代理会自动跟着对齐）。

然后：登录页起个昵称 → 档案页填身体档案 → 记录当天体重 → 回今日页看目标热量 → 点「生成今日食谱」。

### 从 v1 升级到 v2（重要）

第一次启动时后端会自动迁移老库（把 `v1` 时代的数据归到昵称 **「我」** 的账号下）。
**登录页输入「我」就能拿回原来的档案、体重、食谱和收藏的菜谱。**

迁移是自动的，但**动手前务必备份** —— 备份就是复制 `server/data/app.db` 加上旁边的
`app.db-wal` / `app.db-shm` 三个文件（真正的数据在 `-wal` 里，只拷 `.db` 会得到一个空库）。
我已经把当前库备份在 `server/data/backup/`（已 gitignore，不进仓库）。

想先验证迁移没问题再让它上真库：

```bash
cd server && npm run verify:migration
```

它复制一份备份到临时目录、跑完整迁移，核对「存量行数不变 / `user_version` 变成 2 /
数据全归 `local-default` / 反复打开不会二次迁移」，全程不碰真实库。

<details>
<summary>手动启动（不用一键工具时）</summary>

```bash
# 后端（端口 3000）
cd server
npm install
cp .env.example .env        # 填 LLM 配置；不填也能用，只是 AI 功能不可用
npm run dev

# 前端（浏览器打开 http://localhost:5173）
cd client
npm install
npm run dev:h5
```

改了任何依赖版本后**必须重启 dev server** —— Vite 默认不 watch `node_modules`，
旧进程会继续从内存缓存里发旧版代码。`start.bat` 每次启动都会清缓存，不用你操心。
</details>

### LLM 配置

`setup.bat` 会引导你配；也可以直接编辑 `server/.env`。三项必填（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`），**适配器同时支持两套协议**，不用额外开关 —— 地址里带 `/anthropic` 就自动走 Anthropic 协议（`x-api-key` + `anthropic-version`），否则走 OpenAI 兼容协议（`Authorization: Bearer`）。

| 方案 | 地址示例 | 说明 |
|---|---|---|
| Anthropic | `https://api.minimax.cn/anthropic` | 国内站 key 只能在 `.cn` / `.minimaxi.com`，国际站 `.io` 会 401 |
| OpenAI 兼容 | `https://api.deepseek.com/v1` | DeepSeek / Kimi / 通义 / 智谱 |

可选增强项：`LLM_EFFORT`（思考强度，只在 Anthropic 协议下下发，代码不校验、原样透传）、`LLM_TIMEOUT_MS`（超时，默认 30s）、`LLM_PROTOCOL`（强制指定协议）。

> ⚠️ **开了 AI 之后，你的饮食记录会离开这台机器。**
> 具体发出去的是：算食谱所需的缺口数字、你勾选的食材；**以及（如果你用了 AI 换菜 / 整餐兜底）你的口味标记和最近 4 天吃了什么**。
> 这些会发给上面配置的模型服务商。不接受的话就把 `LLM_BASE_URL` 留空 —— 食谱会完全由算法生成，其余功能不受影响。

验证 Key 能不能用（会真的调一次接口）：
```bash
cd server && npx tsx scripts/llm-smoke.ts
```

## 目录结构

```
fitness/
├── setup.bat / start.bat / stop.bat   一键工具（Windows 双击入口）
├── package.json                       根 npm 脚本（setup / start / stop / test / typecheck）
├── scripts/                           一键工具的实现（纯 Node，无依赖）
│   ├── setup.mjs                      装依赖 + 建 .env + 引导填 Key
│   ├── start.mjs                      起双服务 + 开浏览器 + 干净关闭
│   ├── stop.mjs                       找不到启动窗口时的停止办法
│   └── lib/common.mjs                 端口探测 / 杀进程树 / 开浏览器
├── server/                            后端：Fastify + TypeScript（ESM）
│   ├── src/
│   │   ├── index.ts                   入口：起服务
│   │   ├── app.ts                     buildApp()：组装 Fastify + 鉴权 hook + 注册路由
│   │   ├── fastify.d.ts               给 request 挂 userId 的类型声明
│   │   ├── types.ts                   全局共享类型（core/ 对外的唯一契约）
│   │   ├── routes/                    薄路由层：只做 zod 校验 + 调 service
│   │   │   └── auth.ts                登录 / 登出 / 当前用户（唯一免鉴权的一组）
│   │   ├── services/
│   │   │   ├── authService.ts         昵称登录 + token 会话（30 天）
│   │   │   ├── planService.ts         编排：档案 → 体重 → 目标 → 组合 → 落库
│   │   │   └── chefService.ts         AI 出菜 / 换菜 / 兜底
│   │   ├── core/                      ★ 纯函数算法层（无 IO，全部可单测）
│   │   │   ├── bmr.ts                 BMR / TDEE / 目标热量 / 宏量分配
│   │   │   ├── mealSplit.ts           餐次分配（16-8 / 三餐 / 训练日加餐）
│   │   │   ├── planner.ts             食谱组合算法（打分 + 贪心 + 回溯 + 兜底）
│   │   │   ├── nutrition.ts           配料 → 营养汇总
│   │   │   └── stageRule.ts           减脂阶段判定与结构切换建议
│   │   ├── ai/llm.ts                  LLM 适配器（唯一调 LLM 的地方，双协议）
│   │   ├── data/                      静态数据包：foods.json / dishes.json
│   │   └── db/
│   │       ├── sqlite.ts              开连接 + 设 PRAGMA
│   │       ├── migrate.ts             ★ 版本迁移（单用户老库 → 多用户）
│   │       └── repos/                 各表仓储（**每个函数都必须传 userId**）
│   ├── scripts/                       一次性验收脚本（见「测试」）
│   │   └── verify-migration.ts        拿备份副本实跑迁移并核对（不碰真库）
│   └── test/                          vitest 单测（526 条）
│       ├── helpers/app.ts             测试夹具：自动带 token 的 inject / 带用户的内存库
│       ├── db/isolation.test.ts       仓储层隔离（两个用户互不可见）
│       └── e2e-multiuser.test.ts      端到端：走完整 HTTP 链路验隔离
├── client/                            前端：uni-app (Vue 3.4.21 + TS + Pinia 2.1.7)
│   └── src/
│       ├── pages/login/login.vue      登录页（启动页，不进 tabBar）
│       ├── pages/{today,history,chef,profile}/
│       ├── components/NavBar.vue      悬浮式底部导航（避开小程序原生 tabBar 的限制）
│       └── api/
│           ├── token.ts               token 存取（零依赖，避免循环 import）
│           ├── auth.ts                登录接口调用
│           ├── request.ts             统一请求（**带 Authorization**）
│           └── chef.ts                codeRequest（多带 code/llmKind，**也带 Authorization**）
└── docs/
    ├── HANDOFF.md                     交接归档：进度 / 踩坑根因 / 待决策（最完整）
    ├── AGENT-BRIEF.md                 给 AI 协作者的约定（技术栈、TDD、纪律）
    ├── superpowers/
    └── 2026-10-14-fitness-diet*.md     根目录：设计文档与实施计划
```

## 数据

| 文件 | 内容 |
|---|---|
| `server/src/data/foods.json` | 233 种食材营养（基于《中国食物成分表》第 6 版，每 100g） |
| `server/src/data/dishes.json` | 164 道家常菜谱（含配料克数、做法、角色标签） |
| `server/data/app.db` | SQLite 数据库：**备份要复制它和旁边的 `-wal` / `-shm` 三个文件** |
| `server/data/backup/` | 迁移前的整库备份（已 gitignore，不进仓库） |
| ~~`server/src/data/dishes.user.json`~~ | **v2 起不再使用**。你收藏的 AI 菜谱搬进了 `user_dishes` 表；这个文件只留作历史遗留，真库迁移完就可以删 |

可用环境变量 `DATA_DIR` / `FITNESS_DATA_DIR` 把库与数据包放到别处。

## API

**除 `/api/health` 和 `POST /api/auth/login` 外，所有接口都需要登录态** ——
请求头带 `Authorization: Bearer <token>`。没带或失效一律 `401` + `code: "UNAUTHORIZED"`。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/health` | 健康检查（**免登录**） |
| POST | `/api/auth/login` | 昵称登录 → 发 token（**免登录**） |
| POST | `/api/auth/logout` | 注销当前 token |
| GET | `/api/auth/me` | 当前用户 |
| GET/PUT | `/api/profile` | 读/改档案 |
| POST/GET | `/api/profile/weight` | 记/查体重 |
| GET | `/api/profile/weight/history?days=` | 体重历史窗口 |
| GET | `/api/profile/target` | 今日目标热量 + 三大宏量 + 各餐分配 |
| POST | `/api/plan/generate` | 生成今日食谱（`useAiFallback` 可选，默认关） |
| GET | `/api/plan/:date` | 查某天食谱 |
| GET | `/api/plans?limit=` | 历史食谱列表 |
| POST | `/api/plan/:date/reroll-dish` | 换一道菜（纯算法） |
| POST | `/api/chef/cook` | AI 看料做菜 |
| POST | `/api/chef/save-dish` | 存入我的菜谱 |
| POST | `/api/chef/replace-dish` | AI 换一道 |
| GET | `/api/foods` | 食材列表（AI 厨师页选择用） |
| POST/GET | `/api/feedback` | 菜品偏好：喜欢 / 一般 / 不吃 |

业务错误统一返回 `{ error, code }`，`code` 稳定取值：`UNAUTHORIZED` / `INVALID_NICKNAME` /
`NO_PROFILE` / `NO_WEIGHT` / `PLAN_NOT_FOUND` / `INDEX_OUT_OF_RANGE` /
`NOT_CONFIGURED` / `LLM_FAILED` / `UNRESOLVABLE_INGREDIENTS`。

## 测试

```bash
npm test           # 后端 526 条
npm run typecheck  # 前后端一起，必须 0 error
cd client && npm run build:h5   # 前端构建
```

后端测试**零真实网络请求**（LLM 一律注入假实现）、**零真实落盘**，可反复跑、结果确定。
隔离相关的用例在 `test/db/isolation.test.ts`（仓储层）与 `test/e2e-multiuser.test.ts`（端到端）。

一次性验收脚本（改算法后跑一下看真实数据表现）：

```bash
cd server
npx tsx scripts/planner-smoke.ts       # 各热量档位下各餐是否落区间、7 天是否重复
npx tsx scripts/breakfast-repro.ts     # 早餐槽位的退化排查
npx tsx scripts/llm-smoke.ts           # 🔴 会真调一次 LLM 接口（花钱）；验 Key 与协议适配
npm run verify:migration               # 拿备份副本实跑迁移并核对，不碰真库
```

## 环境说明（与原始实施计划的偏差）

| 项 | 计划 | 实际 | 原因 |
|---|---|---|---|
| 数据库 | better-sqlite3 | **Node 内置 `node:sqlite`** | Node 24 下 better-sqlite3 无预编译包，源码编译缺 Visual Studio |
| uni-app 脚手架 | `npx degit` 官方预设 | **手写工程 + 固定版本** | 沙箱拦截外部包拉取 |
| BMR 已知案例 | 男 1780 / 女 1321 | **1748.75 / 1320.25** | 计划里的算例与 Mifflin-St Jeor 公式不符，已按公式纠正 |
| Vue / Pinia 版本 | 未指定 | **Vue 3.4.21 / Pinia 2.1.7（钉死）** | uni-app 自己把 6 个 `@vue/*` 钉在 3.4.21；周边生态已到 Vue 3.5，npm 会为满足它们的 caret 范围**再装一份 3.5.x** → 双 Vue → 白屏。`overrides` 是唯一能压住的手段 |
| 数据库迁移 | 无（`CREATE TABLE IF NOT EXISTS`） | **`PRAGMA user_version` + db/migrate.ts** | `IF NOT EXISTS` 对**已存在的老表**是静默空操作，代码改了库没改，要到运行时才炸。加了版本号才能区分「全新库」和「老库」 |
| 前后端连接数 | 1（设计意图） | **曾有 2，已修** | `app.ts` 注册 chefRoutes 时漏传 `db`，它自己懒开了一个。迁移时两个连接并发改表会撞 `SQLITE_SCHEMA`。现在生产只有 `app.ts` 一处开连接 |

## 已知限制

### 🔴 上线前必须处理

- **登录是纯昵称登录，没有密码也没有验证码 —— 昵称本身就是凭证。**
  现在（2026-10-17）任意输入某个昵称就能进那个账号、看到那个人的全部数据。
  单机一个库时无所谓（只有你自己），但**一旦部署到服务器让所有人共用一个库，等于把所有人的数据公开了**。

  产品要推广给所有人，所以这是硬性前置项。两种改法：
  - **密码登录**：加 `password_hash` 字段，登录时校验
  - **微信登录**（推荐）：只需在 `authService.ts` 的 `login()` 里多一条分支 ——
    用 `wx.login` 的 code 换 openid，按 `(provider='wechat', provider_id=openid)` 找用户。
    `users` 表已经预留了 `provider` / `provider_id` 两列，**表结构、token 机制、鉴权 hook 都不用动**。

  改的时候别忘了「老用户输入『我』认领回历史数据」这条路径 —— 换真正的认证方式时要保留它。

### 其他

- **微信小程序构建当前失败**（M5 远期功能，不在本期范围）。`npm run build:h5` 正常。报错是 rollup 在打包阶段找不到 Vue 的某个内部导出，属于 uni-app 官方包与 Vue 的版本契约问题，H5 不受影响。
- **AI 延迟很不稳定**：同一路径实测在 **1.8 秒 ~ 50 秒** 之间跳。所以默认超时 30s 经常不够，用 `LLM_TIMEOUT_MS` 调大（配了思考强度后尤其需要）。
- **AI 换菜若最终仍给出非法食材 id，报的是 `LLM_FAILED` 而不是 `UNRESOLVABLE_INGREDIENTS`** —— 因为枚举在 schema 阶段就挡下来了，会先重试一次再失败。`UNRESOLVABLE_INGREDIENTS` 仍保留给「单位换算不了」这类场景和未受约束的出菜路径。
- **每日目标 1200 kcal（下限）时晚餐可能报 `degraded`**：菜库最小的「主食 + 蛋白」组合已接近该区间上限，再加蔬菜必超。算法选择宁可如实报降级，也不做「缺蛋白却标达标」的假达标。
- 单餐目标超过约 1400 kcal（16-8 大餐次、极高热量）时，三四个菜凑不满，同样标 `degraded`。
- 食谱**不缩放克数**：靠「选择」而非「调整用量」来贴合目标，所以极端目标下的精度不如缩放方案。
- `reroll-dish` 是**确定性**的：同一份计划重复换同一个槽位会得到同一道菜（没有随机源）。想要「每次换一个」需另行引入。
- 极低热量目标时菜库偏薄（早餐素菜只有 10 道），治本要补一批**小份菜**。
- **多用户隔离靠的是「每个仓储函数都必须传 userId」这个约定**，TypeScript 管不住它 ——
  漏传一个参数不会报错，只会静默读到别人的数据或写到别人名下。
  新增查询时务必确认 `WHERE` / `ON CONFLICT` 目标里有 `user_id`；`test/db/isolation.test.ts` 是防线。

## 分支

| 分支 | 说明 |
|---|---|
| `v2` | **当前版本**（多用户数据隔离）。clone 完 `git checkout v2` |
| `v1` | UI 视觉重做完成的那版，单用户设计 |
| `master` | 冻结的已验证基线，新改动一律不直接落上面 |

## M5（远期，未做）

uni-app 编译微信小程序：`npm run dev:mp-weixin`，开发者工具导入 `dist/dev/mp-weixin`，勾选「不校验合法域名」联调 localhost。上线需 HTTPS 备案域名。

