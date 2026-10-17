/**
 * 认证：昵称登录 + token 会话。
 *
 * ## 现在的定位
 *
 * 现在是**纯昵称登录，没有任何密码**。这样设计是为了能推广出去又不至于堵在第一步，
 * 但要说清楚它的性质：
 *
 * ⚠️ **昵称就是口令。** 谁输入某个昵称，谁就能进那个账号。单机部署（本机一个库）时
 * 只有你自己，无所谓；**一旦部署到服务器让所有人共用一个库，等于把所有人的数据
 * 公开了**。所以「上服务器」这一步之前，必须先换成密码登录或微信登录。
 *
 * ## 以后接微信要改什么
 *
 * 只改 {@link login} 一个函数：拿 `wx.login` 的 code 换 openid，
 * 用 (provider='wechat', provider_id=openid) 找用户，找不到就建。
 * 表结构、token 机制、hook 全都不用动 —— 迁移时留 provider / provider_id
 * 两列就是为了这一天。
 */

import type { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'

/** 会话有效期（天） */
export const SESSION_TTL_DAYS = 30

/** 昵称长度上限，跟前端输入框一致 */
const NICKNAME_MAX = 32

/** 登录方式 */
export type AuthProvider = 'local' | 'wechat'

/** 一个用户 */
export interface AuthUser {
  id: string
  nickname: string
  provider: AuthProvider
}

/** 登录结果 */
export interface LoginResult {
  user: AuthUser
  /** 后续请求放进 Authorization: Bearer <token> */
  token: string
}

/** 认证相关错误码，沿用后端统一的 { error, code } 形状 */
export type AuthErrorCode = 'UNAUTHORIZED' | 'INVALID_NICKNAME'

/** 认证错误：route 层据此转 HTTP 状态码 */
export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

/** 行 → AuthUser（行是 null-prototype，这里显式构造普通对象） */
function toUser(row: Record<string, unknown> | undefined): AuthUser | null {
  if (row === undefined) return null
  return {
    id: String(row['id'] ?? ''),
    nickname: String(row['nickname'] ?? ''),
    provider: String(row['provider'] ?? 'local') as AuthProvider,
  }
}

const USER_COLUMNS = 'id, nickname, provider'

/**
 * 归一化昵称：去首尾空白、把连续空白压成一个空格。
 * 「小明」「  小明 」「小明」必须落到同一个账号上，否则隔离就漏了。
 */
function normalizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** 校验并归一化，不合法抛 INVALID_NICKNAME */
function requireNickname(raw: string): string {
  const nickname = normalizeNickname(raw)
  if (nickname === '') {
    throw new AuthError('INVALID_NICKNAME', '昵称不能为空')
  }
  if ([...nickname].length > NICKNAME_MAX) {
    throw new AuthError('INVALID_NICKNAME', `昵称不能超过 ${NICKNAME_MAX} 个字符`)
  }
  return nickname
}

/** 按 id 取用户 */
export function getUserById(db: DatabaseSync, id: string): AuthUser | null {
  const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined
  return toUser(row)
}

/**
 * 按昵称取本地用户。
 *
 * 只查 provider='local' 且昵称非空的 —— 微信用户的昵称可能还没采集，
 * 那条路径走 (provider, provider_id)，不经过这里。
 */
export function findUserByNickname(db: DatabaseSync, nickname: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users WHERE provider = 'local' AND nickname = ? AND nickname <> ''`,
    )
    .get(normalizeNickname(nickname)) as Record<string, unknown> | undefined
  return toUser(row)
}

/**
 * 直接建号，**不查重**。
 *
 * 给迁移脚本 / 一次性数据修正用；登录请用 {@link login}（同名会复用，重复建号等于
 * 把两个人的数据混在一起）。
 */
export function createUser(db: DatabaseSync, nickname: string, id?: string): AuthUser {
  const clean = requireNickname(nickname)
  const userId = id ?? randomUUID()
  db.prepare('INSERT INTO users (id, nickname, provider) VALUES (?, ?, ?)').run(userId, clean, 'local')
  return { id: userId, nickname: clean, provider: 'local' }
}

/** 32 字节随机 token，十六进制。够长，不靠猜 */
function newToken(): string {
  return randomBytes(32).toString('hex')
}

/** 建会话，返回 token */
function issueSession(db: DatabaseSync, userId: string): string {
  const token = newToken()
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_TTL_DAYS} days'))`,
  ).run(token, userId)
  return token
}

/**
 * 昵称登录。
 *
 * 规则是**同名即复用**：昵称已存在就进那个账号，不存在才建新的。
 * 这样单用户时代的老用户升级后，输入 {@link LOCAL_USER_NICKNAME} 就能拿回自己的老数据，
 * 而不是得到一个空账号。
 *
 * 代价就是开头说的：昵称等于口令，见文件头警告。
 */
export function login(db: DatabaseSync, nickname: string): LoginResult {
  const clean = requireNickname(nickname)
  const existing = findUserByNickname(db, clean)
  const user = existing ?? createUser(db, clean)
  return { user, token: issueSession(db, user.id) }
}

/** 从 Authorization 头取值，剥掉 `Bearer ` 前缀；没有或格式不对返回 null */
export function extractBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token !== undefined && token !== '' ? token : null
}

/**
 * 用 token 解析用户；无效 / 过期 / 不存在都返回 null。
 *
 * 过期判断放在 SQL 里（expires_at > now），而不是取出来在 JS 里比 ——
 * 少一次往返，也不会因为时区写法不一致而算错。
 */
export function resolveToken(db: DatabaseSync, token: string | null): AuthUser | null {
  if (token === null || token === '') return null
  const bare = extractBearer(token) ?? token.trim()
  const row = db
    .prepare(
      `SELECT u.id, u.nickname, u.provider
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(bare) as Record<string, unknown> | undefined
  return toUser(row)
}

/** 注销：删掉这个 token 的会话。token 不存在返回 false */
export function logout(db: DatabaseSync, token: string | null): boolean {
  if (token === null || token === '') return false
  const bare = extractBearer(token) ?? token.trim()
  const info = db.prepare('DELETE FROM sessions WHERE token = ?').run(bare)
  return Number(info.changes) > 0
}

/** 清掉某个用户的全部会话（「退出所有设备」） */
export function logoutAll(db: DatabaseSync, userId: string): number {
  return Number(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes)
}

/**
 * 从请求里取当前用户 id，取不到就抛 UNAUTHORIZED。
 *
 * **所有业务接口都必须过这一关**，不要直接读 `request.userId` ——
 * 那样漏掉一处检查，那个接口就成了所有人的公共入口。
 *
 * ⚠️ `undefined` 也要挡。有些路由是被单独注册、没经过 app.ts 的 decorateRequest 的
 * （单元测试直接 register(chefRoutes) 就是这种），那时 request.userId 是 undefined 而不是 null，
 * 只判 `=== null` 会让未登录请求**带着 undefined 走进业务逻辑**。
 */
export function requireUser(request: { userId?: string | null }): string {
  if (request.userId === undefined || request.userId === null || request.userId === '') {
    throw new AuthError('UNAUTHORIZED', '请先登录')
  }
  return request.userId
}

/**
 * 顺手清一遍过期会话。
 *
 * 单独提供而不是每次请求都跑：过期行不影响正确性（resolveToken 本来就查 expires_at），
 * 只是占空间。挂到登录接口上顺手做即可。
 */
export function purgeExpired(db: DatabaseSync): number {
  return Number(
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run().changes,
  )
}
