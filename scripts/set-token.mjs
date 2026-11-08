#!/usr/bin/env node
/**
 * Rotate the Kindle login token.
 *
 *   node scripts/set-token.mjs ~/kindle-ws            # random 32 chars
 *   node scripts/set-token.mjs ~/kindle-ws mkbngzfA1 # or an explicit token
 *
 * The HTTP shell only re-imports app.js when a watched file changes, so a new
 * .kindle-token alone would wait for a Host restart. Touching lib/app.js makes
 * the next request load a generation, and createApp re-hashes the token before
 * authorization. The old cookie stops working on that same request.
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [dir, given] = process.argv.slice(2)
if (!dir) {
  console.error('用法: node scripts/set-token.mjs <工作区目录> [token]')
  process.exit(1)
}

const token = given || randomBytes(24).toString('base64url')
if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) {
  console.error('token 只能是 8–64 位字母、数字、下划线或短横线。')
  process.exit(1)
}

const file = join(dir, '.kindle-token')
writeFileSync(file, token + '\n')
chmodSync(file, 0o600)

const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'app.js')
if (existsSync(app)) {
  const now = new Date()
  utimesSync(app, now, now)
  console.log('已写入 ' + file + '。下一次请求会重载并启用新 token，旧 cookie 随即失效。')
} else {
  console.log('已写入 ' + file + '。没找到 ' + app + '，重启 Host 后生效。')
}
console.log('新 token: ' + token)
