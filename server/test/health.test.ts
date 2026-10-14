import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db/sqlite.js'

describe('GET /api/health', () => {
  it('returns ok', async () => {
    // 传内存库，避免测试在 server/data/ 下生成真实 app.db
    const app = buildApp({ db: openDb(':memory:') })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })
})
