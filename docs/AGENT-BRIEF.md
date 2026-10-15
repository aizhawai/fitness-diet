# 子代理通用约定（写代码前必读）

项目根目录：仓库根（本文档所在目录的上一级），下含 `server/` 与 `client/`
后端根目录：`server/`

## 技术环境（已固定，不要改）

- Node v24.15.0，npm 11
- ESM（`package.json` 有 `"type": "module"`）+ tsconfig `module: NodeNext`
  - **所有相对 import 必须带 `.js` 后缀**，即使源文件是 `.ts`：
    `import { calcBmr } from '../core/bmr.js'`
- TypeScript strict + `noUncheckedIndexedAccess: true`
  - `arr[i]` 类型是 `T | undefined`，数组下标访问必须处理 undefined
- **数据库用 Node 内置 `node:sqlite`**（不是 better-sqlite3，Node24 无预编译包）
- zod **v4**（不是 v3）：顶层 API，如 `z.email()`、`z.string().min(1)`；
  `z.infer<typeof S>` 照常用；错误用 `schema.safeParse()`

## TDD 流程（强制）

每个任务：先写失败测试 → 跑 `npx vitest run` 确认失败 → 实现 → 跑测试确认通过。
不要跳过「确认失败」这一步。

## 命令

```bash
cd server
npx vitest run                 # 全量测试
npx vitest run test/core/bmr   # 只跑某文件
npx tsc --noEmit               # 类型检查，必须 0 error
```

## 代码风格

- 注释与标识符用中文（与设计文档一致），保持简洁
- `core/` 下**必须是纯函数**：不 import 任何 db / fs / 网络 / fastify
- core 函数签名里，数据（菜谱、食材表、偏好表、历史）一律**以参数传入**，不读全局
- 数值结果统一保留 1 位小数（`Math.round(x*10)/10`），热量取整
- 命名与设计文档一致：`calcBmr` / `calcTdee` / `calcDailyTarget` / `calcMacros` /
  `splitMeals` / `calcNutrition` / `generateDay` / `callLlm`

## 测试注意

- `node:sqlite` 返回的行是 **null-prototype 对象**：
  用 `toEqual` 不用 `toStrictEqual`；需要 `hasOwnProperty` 时先 `{ ...row }` 展开
- `openDb(':memory:')` 建内存库跑集成测试
- Fastify 路由测试用 `app.inject({ method, url, payload })`，不起真实端口

## 纪律

- **只改你被分配的文件**。其他文件即使看起来有问题也不要动，在回报里说明即可。
- 不要 git commit（由我统一提交）
- 不要 `npm install` 新依赖（依赖清单已固定，需要新依赖在回报里提出）
- 不要改 `package.json` / `tsconfig.json` / `vitest.config.ts`
