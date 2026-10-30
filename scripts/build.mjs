import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const tsc = new URL('../node_modules/typescript/bin/tsc', import.meta.url)

for (const shell of ['lib/index.js', 'lib/hot.js']) {
  if (!existsSync(new URL(shell, root))) {
    console.error('build: 缺少稳定壳 ' + shell)
    process.exit(1)
  }
}

execFileSync(process.execPath, [fileURLToPath(tsc), '-p', fileURLToPath(root)], { stdio: 'inherit' })
