# 健身减脂饮食管理

本地跑的个人减脂饮食工具。按体重动态算每日热量与宏量，算法生成不重复的每日食谱，AI 做增强（看料做菜 / 换一道 / 兜底）。数据全部存本地 SQLite 文件。

## 核心设计

**计算与算法全在后端 `core/` 纯函数层** —— 不碰数据库、不碰网络，可独立单测。热量计算、宏量分配、食谱组合是产品心脏；换前端（网页 → 微信小程序）或加 AI，核心算法不动。

**AI 不参与营养计算。** AI 只输出结构化 JSON（菜名 + 配料表），营养数字一律由后端食材表按克数算 —— 从根上规避模型编数字。

**产品永远可用。** AI 挂了、超时、返回垃圾，都静默降级为纯算法生成；算法凑不出达标组合时用「纯食材项」兜底并如实标记 `degraded`。

## 快速开始

**Windows 上双击就行，两个文件：**

| 文件 | 什么时候用 | 做什么 |
|---|---|---|
| **`setup.bat`** | 换电脑、第一次跑 | 检查 Node 版本 → 装前后端依赖 → 建 `.env` → 引导填 LLM 配置 |
| **`start.bat`** | 日常启动 | 同时起后端与前端 → 等就绪 → 自动开浏览器 |

日常启动只需要 `start.bat` 一个。关掉时按一次 **Ctrl+C**，两个进程连同子进程一起收掉，不留残留占用端口。

不想双击的话，仓库根目录也有 `npm` 脚本（等价）：

```bash
npm run setup     # 同 setup.bat
npm start         # 同 start.bat
```

**端口被占用时会先问你**：显示是哪个 PID 占着，回 `y` 才杀、回 `N` 直接退出。
想固定用别的端口可以设环境变量 `SERVER_PORT` / `CLIENT_PORT`（前端代理会自动跟着对齐）。

然后：档案页填身体档案 → 记录当天体重 → 回今日页看目标热量 → 点「生成今日食谱」。

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
</details>

### LLM 配置

`setup.bat` 会引导你配；也可以直接编辑 `server/.env`。三项必填（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`），**适配器同时支持两套协议**，不用额外开关 —— 地址里带 `/anthropic` 就自动走 Anthropic 协议（`x-api-key` + `anthropic-version`），否则走 OpenAI 兼容协议（`Authorization: Bearer`）。

| 方案 | 地址示例 | 说明 |
|---|---|---|
| Anthropic | `https://api.minimax.cn/anthropic` | 国内站 key 只能在 `.cn` / `.minimaxi.com`，国际站 `.io` 会 401 |
| OpenAI 兼容 | `https://api.deepseek.com/v1` | DeepSeek / Kimi / 通义 / 智谱 |

可选增强项：`LLM_EFFORT`（思考强度，只在 Anthropic 协议下下发，代码不校验、原样透传）、`LLM_TIMEOUT_MS`（超时，默认 30s）、`LLM_PROTOCOL`（强制指定协议）。

验证 Key 能不能用（会真的调一次接口）：
```bash
cd server && npx tsx scripts/llm-smoke.ts
```

## 目录结构

```
fitness/
├── server/                     后端：Fastify + TypeScript（ESM）
│   ├── src/
│   │   ├── index.ts            入口：起服务
│   │   ├── app.ts              buildApp()：组装 Fastify 并注册路由
│   │   ├── types.ts            全局共享类型（core/ 对外的唯一契约）
│   │   ├── routes/             薄路由层：只做 zod 校验 + 调 service
│   │   ├── services/           编排层：串起 core + db + ai
│   │   ├── core/               ★ 纯函数算法层（无 IO，全部可单测）
│   │   │   ├── bmr.ts          BMR / TDEE / 目标热量 / 宏量分配
│   │   │   ├── mealSplit.ts    餐次分配（16-8 / 三餐 / 训练日加餐）
│   │   │   ├── planner.ts      食谱组合算法（打分 + 贪心 + 回溯 + 兜底）
│   │   │   ├── nutrition.ts    配料 → 营养汇总
│   │   │   └── stageRule.ts    减脂阶段判定与结构切换建议
│   │   ├── ai/llm.ts           LLM 适配器（唯一调 LLM 的地方）
│   │   ├── data/               静态数据包：foods.json / dishes.json
│   │   └── db/                 SQLite 连接与各表仓储
│   └── test/                   vitest 单测
├── client/                     前端：uni-app (Vue3 + TS + Pinia)
│   └── src/{pages,components,api,stores}
└── docs/                       设计文档与实施计划
```

## 数据

| 文件 | 内容 |
|---|---|
| `server/src/data/foods.json` | 233 种食材营养（基于《中国食物成分表》第 6 版，每 100g） |
| `server/src/data/dishes.json` | 164 道家常菜谱（含配料克数、做法、角色标签） |
| `server/src/data/dishes.user.json` | 你自己通过 AI 厨师保存的菜（不存在即正常，已 gitignore） |
| `server/data/app.db` | SQLite 数据库：**备份就是复制这个文件** |

可用环境变量 `DATA_DIR` / `FITNESS_DATA_DIR` 把库与数据包放到别处。

## API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
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

业务错误统一返回 `{ error, code }`，`code` 稳定取值：`NO_PROFILE` / `NO_WEIGHT` / `PLAN_NOT_FOUND` / `INDEX_OUT_OF_RANGE` / `NOT_CONFIGURED` / `LLM_FAILED` / `UNRESOLVABLE_INGREDIENTS`。

## 测试

```bash
cd server
npm test          # 430 条全量单测
npm run typecheck # 0 error

cd ../client
npm run typecheck
npm run build:h5
```

后端测试**零真实网络请求**（LLM 一律注入假实现）、**零真实落盘**（`dishes.user.json` 写到临时目录），可反复跑、结果确定。

一次性验收脚本（改算法后跑一下看真实数据表现）：

```bash
cd server
npx tsx scripts/planner-smoke.ts       # 各热量档位下各餐是否落区间、7 天是否重复
npx tsx scripts/breakfast-repro.ts     # 早餐槽位的退化排查
npx tsx scripts/llm-smoke.ts           # 🔴 会真调一次 LLM 接口（花钱）；验 Key 与协议适配
```

## 环境说明（与原始实施计划的三处偏差）

| 项 | 计划 | 实际 | 原因 |
|---|---|---|---|
| 数据库 | better-sqlite3 | **Node 内置 `node:sqlite`** | Node 24 下 better-sqlite3 无预编译包，源码编译缺 Visual Studio |
| uni-app 脚手架 | `npx degit` 官方预设 | **手写工程 + 固定版本** | 沙箱拦截外部包拉取 |
| BMR 已知案例 | 男 1780 / 女 1321 | **1748.75 / 1320.25** | 计划里的算例与 Mifflin-St Jeor 公式不符，已按公式纠正 |

## 已知限制

- **微信小程序构建当前失败**（M5 远期功能，不在本期范围）。`npm run build:h5` 正常。报错是 rollup 在打包阶段找不到 Vue 的某个内部导出，属于 uni-app 官方包与 Vue 的版本契约问题，H5 不受影响。
- **每日目标 1200 kcal（下限）时晚餐可能报 `degraded`**：菜库最小的「主食 + 蛋白」组合已接近该区间上限，再加蔬菜必超。算法选择宁可如实报降级，也不做「缺蛋白却标达标」的假达标。
- 单餐目标超过约 1400 kcal（16-8 大餐次、极高热量）时，三四个菜凑不满，同样标 `degraded`。
- 食谱**不缩放克数**：靠「选择」而非「调整用量」来贴合目标，所以极端目标下的精度不如缩放方案。
- `reroll-dish` 是**确定性**的：同一份计划重复换同一个槽位会得到同一道菜（没有随机源）。想要「每次换一个」需另行引入。

## M5（远期，未做）

uni-app 编译微信小程序：`npm run dev:mp-weixin`，开发者工具导入 `dist/dev/mp-weixin`，勾选「不校验合法域名」联调 localhost。上线需 HTTPS 备案域名。
