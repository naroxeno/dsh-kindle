import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const tsc = root + 'node_modules/typescript/bin/tsc'
const out = root + '.dist-check'

rmSync(out, { recursive: true, force: true })
execFileSync(process.execPath, [tsc, '-p', root, '--outDir', out], { stdio: 'inherit' })

const fail = (message) => {
  console.error('check-dist: ' + message)
  process.exit(1)
}

for (const shell of ['index.js', 'hot.js']) {
  if (existsSync(root + 'src/' + shell)) fail('src/ 下不允许出现稳定壳 ' + shell)
  if (!existsSync(root + 'lib/' + shell)) fail('缺少 lib/' + shell)
}

const modules = readdirSync(root + 'src').filter((name) => name.endsWith('.ts') || name.endsWith('.js'))
let first = null
for (const name of modules) {
  const built = out + '/' + name.replace(/\.ts$/, '.js')
  const shipped = root + 'lib/' + name.replace(/\.ts$/, '.js')
  if (!existsSync(built)) fail('编译结果缺少 ' + built.replace(root, ''))
  if (!existsSync(shipped)) fail('lib/ 缺少 ' + name.replace(/\.ts$/, '.js'))
  if (!readFileSync(built).equals(readFileSync(shipped))) {
    if (!first) first = { built, shipped }
    console.error('check-dist: lib/' + name.replace(/\.ts$/, '.js') + ' 与编译结果不一致')
  }
}

if (first) {
  let diff = ''
  try {
    diff = execFileSync('diff', ['-u', first.built, first.shipped], { encoding: 'utf8' })
  } catch (error) {
    diff = error.stdout || ''
  }
  console.error(diff.split('\n').slice(0, 40).join('\n'))
  process.exit(1)
}
