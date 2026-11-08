#!/usr/bin/env node
/**
 * Set the six-digit PIN for the Kindle file browser.
 *
 *   node scripts/set-files-pin.mjs ~/kindle-ws 246810
 *
 * Writes <dir>/.kindle-files-pin as a scrypt hash (0600). The plugin picks the
 * new PIN up on the next request: no Host restart, no cookie changes.
 */
import { randomBytes, scryptSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, pin] = process.argv.slice(2)
if (!dir || !/^\d{6}$/.test(pin || '')) {
  console.error('用法: node scripts/set-files-pin.mjs <工作区目录> <6 位数字>')
  process.exit(1)
}

const salt = randomBytes(16)
const digest = scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 })
const line = ['scrypt', 16384, 8, 1, salt.toString('hex'), digest.toString('hex')].join('$') + '\n'
const file = join(dir, '.kindle-files-pin')
writeFileSync(file, line, { mode: 0o600 })
console.log('已写入 ' + file + '。文件页密码已更新，下一次请求生效。')
