/**
 * 认证服务测试：昵称登录 → 发 token → 用 token 解析回用户。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../../src/db/sqlite.js'
import {
  AuthError,
  SESSION_TTL_DAYS,
  createUser,
  getUserById,
  findUserByNickname,
  login,
  logout,
  resolveToken,
} from '../../src/services/authService.js'
import { LOCAL_USER_ID, LOCAL_USER_NICKNAME } from '../../src/db/migrate.js'
import type { DatabaseSync } from 'node:sqlite'

let db: DatabaseSync

/** 数行数。SQLite 的 get() 在 noUncheckedIndexedAccess 下可能返回 undefined */
function count(sql: string): number {
  return Number(db.prepare(sql).get()?.n ?? -1)
}

describe('昵称登录', () => {
  beforeEach(() => {
    db = openDb(':memory:')
  })

  it('新昵称 → 建号 + 发 token', () => {
    const { user, token } = login(db, '小明')
    expect(user.nickname).toBe('小明')
    expect(user.id).not.toBe('')
    expect(user.provider).toBe('local')
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThanOrEqual(32)
  })

  it('同一昵称再次登录 → 复用同一个账号，不新建', () => {
    const first = login(db, '小明')
    const second = login(db, '小明')
    expect(second.user.id).toBe(first.user.id)
    expect(count('SELECT COUNT(*) AS n FROM users')).toBe(1)
  })

  it('昵称会去首尾空白：�� 小明 」与「小明」是同一个账号', () => {
    const first = login(db, '小明')
    const second = login(db, '  小明  ')
    expect(second.user.id).toBe(first.user.id)
  })

  it('昵称为空或纯空白 → 抛 AuthError，不建号', () => {
    expect(() => login(db, '')).toThrow(AuthError)
    expect(() => login(db, '   ')).toThrow(AuthError)
    expect(() => login(db, '\t\n')).toThrow(AuthError)
    expect(count('SELECT COUNT(*) AS n FROM users')).toBe(0)
  })

  it('昵称超长 → 拒绝', () => {
    expect(() => login(db, 'x'.repeat(200))).toThrow(AuthError)
  })

  it('两次登录发的是不同 token（旧 token 仍然有效，直到过期）', () => {
    const first = login(db, '小明')
    const second = login(db, '小明')
    expect(second.token).not.toBe(first.token)
    expect(resolveToken(db, first.token)?.id).toBe(first.user.id)
    expect(resolveToken(db, second.token)?.id).toBe(first.user.id)
  })

  it('每个用户拿到的 token 互不相同', () => {
    const tokens = new Set([login(db, '甲').token, login(db, '乙').token, login(db, '丙').token])
    expect(tokens.size).toBe(3)
  })
})

describe('token 解析', () => {
  beforeEach(() => {
    db = openDb(':memory:')
  })

  it('有效 token 能解析回用户', () => {
    const { user, token } = login(db, '小明')
    const resolved = resolveToken(db, token)
    expect(resolved?.id).toBe(user.id)
    expect(resolved?.nickname).toBe('小明')
  })

  it('Bearer 前缀会被剥掉', () => {
    const { token } = login(db, '小明')
    expect(resolveToken(db, `Bearer ${token}`)?.nickname).toBe('小明')
  })

  it('未知 / 空 / 乱写的 token 都解析为 null', () => {
    expect(resolveToken(db, '')).toBeNull()
    expect(resolveToken(db, 'nope')).toBeNull()
    expect(resolveToken(db, 'Bearer nope')).toBeNull()
    expect(resolveToken(db, `${'x'.repeat(64)}`)).toBeNull()
  })

  it('过期的 token 解析为 null', () => {
    const { user, token } = login(db, '小明')
    // 手工把过期时间拨到过去
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?").run(token)
    expect(resolveToken(db, token)).toBeNull()
    // 用户本身还在，只是会话过期
    expect(getUserById(db, user.id)?.nickname).toBe('小明')
  })

  it('有效期默认 30 天', () => {
    const { token } = login(db, '小明')
    const row = db
      .prepare(
        "SELECT CAST((julianday(expires_at) - julianday(created_at)) AS INTEGER) AS d FROM sessions WHERE token = ?",
      )
      .get(token) as { d: number }
    expect(Number(row.d)).toBe(SESSION_TTL_DAYS)
  })
})

describe('登出', () => {
  beforeEach(() => {
    db = openDb(':memory:')
  })

  it('登出后该 token 立刻失效', () => {
    const { token } = login(db, '小明')
    expect(resolveToken(db, token)).not.toBeNull()
    expect(logout(db, token)).toBe(true)
    expect(resolveToken(db, token)).toBeNull()
  })

  it('登出不存在的 token 返回 false，不抛错', () => {
    expect(logout(db, 'nope')).toBe(false)
  })

  it('登出只影响这一个 token，同账号另一个会话仍有效', () => {
    const first = login(db, '小明')
    const second = login(db, '小明')
    logout(db, first.token)
    expect(resolveToken(db, first.token)).toBeNull()
    expect(resolveToken(db, second.token)).not.toBeNull()
  })
})

describe('用户查询', () => {
  beforeEach(() => {
    db = openDb(':memory:')
  })

  it('getUserById 按 id 取，���存在返回 null', () => {
    const { user } = login(db, '小明')
    expect(getUserById(db, user.id)?.nickname).toBe('小明')
    expect(getUserById(db, 'ghost')).toBeNull()
  })

  it('findUserByNickname 按昵称取', () => {
    const { user } = login(db, '小明')
    expect(findUserByNickname(db, '小明')?.id).toBe(user.id)
    expect(findUserByNickname(db, '不存在')).toBeNull()
  })
})

describe('与老数据用户的衔接', () => {
  beforeEach(() => {
    db = openDb(':memory:')
  })

  it('迁移建出来的 local-default 能用它的昵称登录并复用该账号', () => {
    // 模拟迁移：手工插一个 local-default
    db.prepare('INSERT INTO users (id, nickname, provider) VALUES (?, ?, ?)').run(
      LOCAL_USER_ID,
      LOCAL_USER_NICKNAME,
      'local',
    )

    const { user, token } = login(db, LOCAL_USER_NICKNAME)
    // 关键：必须复用 local-default，而不是新建一个空账号 ——
    // 否则老用户升级后会看不到自己的历史数据
    expect(user.id).toBe(LOCAL_USER_ID)
    expect(resolveToken(db, token)?.id).toBe(LOCAL_USER_ID)
  })

  it('createUser 直接建号，忽略已存在与否（供迁移/脚本用）', () => {
    const user = createUser(db, '直接建的')
    expect(user.nickname).toBe('直接建的')
    expect(findUserByNickname(db, '直接建的')?.id).toBe(user.id)
  })
})
