import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/**
 * 端口与代理目标都允许用环境变量覆盖（默认仍是 3000 / 5173）：
 * 这台机器上 3000 常被旧进程占着，起临时后端时用
 * `PORT=3001 npx tsx src/index.ts` + `API_PROXY_TARGET=http://localhost:3001 PORT=5274 npm run dev:h5`
 * 就能不起冲突、不改动任何写死的值。
 */
const DEV_PORT = Number(process.env.PORT ?? 5173)
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3000'

/**
 * 端口被占时是否直接报错，而不是悄悄换到下一个端口。
 *
 * 一键启动器（scripts/start.mjs）会先做端口预检，所以这里设成严格模式：
 * 万一预检漏了（比如有进程在两次检查之间抢占），宁可**大声失败**，
 * 也不要 vite 静默换端口 —— 那样用户看到的地址和代理目标会对不上，
 * 排查起来比启动失败难受得多。手动 npm run dev:h5 时保持默认行为不变。
 */
const STRICT_PORT = process.env.STRICT_PORT === '1'

export default defineConfig({
  plugins: [uni()],
  server: {
    port: DEV_PORT,
    strictPort: STRICT_PORT,
    // H5 开发环境把 /api 代理到本地后端，前端 baseURL 用相对路径即可
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})
