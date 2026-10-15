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

export default defineConfig({
  plugins: [uni()],
  server: {
    port: DEV_PORT,
    // H5 开发环境把 /api 代理到本地后端，前端 baseURL 用相对路径即可
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})
