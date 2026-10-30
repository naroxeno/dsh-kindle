/**
 * Hot-reload test: edit files under a running plugin and check the next
 * request serves the new code without restarting anything.
 *
 * The plugin is copied to a temp dir so the real lib/ is never touched, and
 * node_modules is a symlink to this package's dependencies (MathJax is heavy).
 * Unlike the print-style harnesses, the assertions here are real: a failure
 * exits non-zero.
 */
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const bundle = fileURLToPath(new URL('../', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'kindle-hot-'))
const port = 8094
const token = 'hotsecret'
const base = 'http://127.0.0.1:' + port
const cookie = { cookie: 'kd=' + token }
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

await cp(join(bundle, 'lib'), join(root, 'lib'), { recursive: true })
await cp(join(bundle, 'prompt'), join(root, 'prompt'), { recursive: true })
await cp(join(bundle, 'package.json'), join(root, 'package.json'))
await symlink(join(bundle, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')

const cwd = join(root, 'ws')
const sessionsById = new Map()
function addSession(id) {
  sessionsById.set(id, {
    sessionId: id,
    cwd,
    running: false,
    blank: false,
    updatedAt: Date.now(),
    projections: { values: { title: '热重载 ' + id } },
    parentSessionId: undefined,
    origin: 'user',
  })
}

function eventsOf() {
  return [
    { type: 'user/message', seq: 1, time: Date.now(), surfaceOp: { op: 'append' },
      data: { message: { role: 'user', content: [{ type: 'text', text: '热重载测试' }] } } },
    { type: 'assistant/message', seq: 2, time: Date.now(), surfaceOp: { op: 'append' },
      data: { message: { role: 'assistant', content: [{ type: 'text', text: '答案是 $x^2 + 1$' }] } } },
  ]
}

// A fake systemPrompt.section mirrors the real service: registering the same
// name twice throws, and the returned disposer removes the insertion.
const agents = new Map()
const sections = []
function makeSection(id) {
  const installed = new Map()
  return (options) => {
    if (installed.has(options.name)) throw new Error('prompt section ' + options.name + ' is already registered')
    installed.set(options.name, options.text)
    sections.push({ sessionId: id, name: options.name, text: options.text })
    return () => { installed.delete(options.name) }
  }
}

const sessionController = {
  async list() {
    return { items: [...sessionsById.values()].map((s) => ({
      sessionId: s.sessionId, cwd: s.cwd, running: s.running, blank: s.blank,
      updatedAt: s.updatedAt, projections: s.projections,
      parentSessionId: s.parentSessionId, origin: s.origin,
    })) }
  },
  async inspect(id) {
    const s = sessionsById.get(id)
    if (!s) throw new Error('no session')
    return { meta: { sessionId: id, cwd }, inheritedEventCount: 0, events: eventsOf() }
  },
  async modelCatalog() {
    return { default: { provider: 'test', model: 'test' }, routableProviders: ['test'], groups: [], failures: [] }
  },
  async projections() {
    return { kind: 'sequenced', asOfSeq: 2, values: { modelSelection: { lastUsed: null, next: null } } }
  },
  async resolveAgent(id) {
    if (!agents.has(id)) agents.set(id, { id, ctx: { systemPrompt: { section: makeSection(id) } } })
    return { agent: agents.get(id) }
  },
}

const disposers = []
const ctx = {
  logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  effect: (fn) => { disposers.push(fn()) },
  sessionController,
  inject: (deps, callback) => { callback(ctx) },
}

const { apply } = await import(pathToFileURL(join(root, 'lib', 'index.js')).href + '?test=' + Date.now())
await apply(ctx, { host: '127.0.0.1', port, cwd, token, fontSize: 30, pageSize: 6 })

async function getText(path, options) {
  const res = await fetch(base + path, {
    redirect: 'manual',
    ...(options || {}),
    headers: { ...cookie, ...((options && options.headers) || {}) },
  })
  return { status: res.status, headers: res.headers, text: await res.text() }
}

async function ready() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await getText('/debug')
      if (res.status === 200) return res.text
    } catch {
      /* still starting */
    }
    await sleep(100)
  }
  throw new Error('the plugin never started listening on ' + base)
}

function lineOf(text, prefix) {
  return text.split('\n').find((row) => row.startsWith(prefix)) || ''
}
function hotOf(text) {
  const line = lineOf(text, 'hot: generation ')
  const parts = line.split(' ')
  const error = lineOf(text, 'hot error: ')
  return {
    generation: parts.length > 2 ? Number(parts[2]) : -1,
    reloads: parts.length > 3 ? Number(parts[3].slice(1)) : -1,
    error: error ? error.slice('hot error: '.length) : '',
  }
}
function bytesOf(text) {
  const line = lineOf(text, 'prompt bytes: ')
  return line ? Number(line.slice('prompt bytes: '.length)) : -1
}
function promptStatusOf(text) {
  const line = text.split('\n').find((row) => row.startsWith('{') && row.includes('"registered"'))
  return line ? JSON.parse(line) : null
}
function svgWidth(html) {
  const start = html.indexOf('<svg')
  if (start === -1) return -1
  const tag = html.slice(start, html.indexOf('>', start))
  const at = tag.indexOf(' width="')
  if (at === -1) return -1
  const rest = tag.slice(at + 8)
  return Number.parseFloat(rest.slice(0, rest.indexOf('"')))
}

let cleanupRoot = true
try {
  let debug = await ready()
  const hot0 = hotOf(debug)
  assert.equal(hot0.generation, 1, 'the first generation loads on startup')
  assert.equal(hot0.reloads, 0, 'startup is not counted as a reload')
  const list0 = await getText('/s')
  assert.equal(list0.status, 200)
  assert.ok(list0.text.includes('这里还没有会话'), 'empty list page renders')
  const bytes0 = bytesOf(debug)
  console.log('baseline: generation', hot0.generation, '| prompt bytes', bytes0)

  // 1. edit the page module itself.
  const uiPath = join(root, 'lib', 'ui.js')
  const uiSource = await readFile(uiPath, 'utf8')
  assert.ok(uiSource.includes('</body></html>'), 'page shell exists in ui.js')
  const uiMarked1 = uiSource.replace('</body></html>', '<!--HOT-UI-1--></body></html>')
  await writeFile(uiPath, uiMarked1)
  await sleep(320)
  const list1 = await getText('/s')
  assert.equal(list1.status, 200)
  assert.ok(list1.text.includes('HOT-UI-1'), 'a request after the edit uses the new ui.js')
  const hot1 = hotOf((await getText('/debug')).text)
  assert.equal(hot1.generation, hot0.generation + 1, 'generation advanced')
  assert.equal(hot1.reloads, 1, 'reload counted')
  assert.equal(hot1.error, '', 'no load error')
  console.log('ui.js edit -> generation', hot1.generation)

  // 2. edit a dependency two levels down: ui.js -> markdown.js -> math.js.
  addSession('hot-1')
  const pageA = await getText('/c/hot-1')
  assert.equal(pageA.status, 200, 'session page renders')
  const widthA = svgWidth(pageA.text)
  assert.ok(widthA > 0, 'message math renders an svg')
  const mathPath = join(root, 'lib', 'math.js')
  const mathSource = await readFile(mathPath, 'utf8')
  assert.ok(mathSource.includes('const UNITS_PER_EM = 1000'), 'math constant exists')
  await writeFile(mathPath, mathSource.replace('const UNITS_PER_EM = 1000', 'const UNITS_PER_EM = 2000'))
  await sleep(320)
  const pageB = await getText('/c/hot-1')
  assert.equal(pageB.status, 200)
  const widthB = svgWidth(pageB.text)
  assert.ok(Math.abs(widthB - widthA / 2) < 0.3, 'new math.js geometry applies (' + widthA + ' -> ' + widthB + ')')
  const hot2 = hotOf((await getText('/debug')).text)
  assert.equal(hot2.generation, hot1.generation + 1, 'generation advanced for a nested dependency')
  assert.equal(hot2.error, '', 'no load error')
  console.log('math.js edit -> generation', hot2.generation, '| svg width', widthA, '->', widthB)

  // 3. edit the prompt file: the page re-registers the section instead of
  //    throwing 'already registered'.
  const promptPath = join(root, 'prompt', 'kindle.md')
  const promptSource = await readFile(promptPath, 'utf8')
  await writeFile(promptPath, promptSource + '\n\nHOT-PROMPT-MARK 热重载提示词。\n')
  await sleep(320)
  const pageC = await getText('/c/hot-1')
  assert.equal(pageC.status, 200)
  const mine = sections.filter((section) => section.sessionId === 'hot-1' && section.name === 'kindle:display')
  assert.equal(mine.length, 2, 'the section was replaced exactly once')
  assert.ok(mine[1].text.includes('HOT-PROMPT-MARK'), 'the new prompt text is installed')
  const debugC = (await getText('/debug')).text
  const hot3 = hotOf(debugC)
  assert.equal(hot3.generation, hot2.generation + 1, 'generation advanced for prompt/kindle.md')
  assert.equal(hot3.error, '', 'no load error')
  const statusC = promptStatusOf(debugC)
  assert.ok(statusC && statusC.lastError === '', 'no duplicate-registration error: ' + JSON.stringify(statusC))
  assert.ok(bytesOf(debugC) > bytes0, 'prompt bytes grew')
  console.log('prompt/kindle.md edit -> generation', hot3.generation, '| prompt bytes', bytesOf(debugC))

  // 4. a file with a syntax error must not take the UI down.
  await writeFile(uiPath, uiMarked1 + '\nexport function broken( {\n')
  await sleep(320)
  const listBroken = await getText('/s')
  assert.equal(listBroken.status, 200, 'the previous generation keeps serving')
  assert.ok(listBroken.text.includes('HOT-UI-1'), 'still the old ui.js')
  const hotBroken = hotOf((await getText('/debug')).text)
  assert.equal(hotBroken.generation, hot3.generation, 'a broken file creates no generation')
  assert.ok(hotBroken.error.length > 0, 'the load error is reported')
  console.log('broken ui.js -> generation stayed', hotBroken.generation, '|', hotBroken.error.slice(0, 90))

  // 5. fixing the file recovers without a restart.
  await writeFile(uiPath, uiMarked1.replace('HOT-UI-1', 'HOT-UI-2'))
  await sleep(320)
  const listFixed = await getText('/s')
  assert.equal(listFixed.status, 200)
  assert.ok(listFixed.text.includes('HOT-UI-2'), 'the fixed file loads')
  const debugFixed = (await getText('/debug')).text
  const hotFixed = hotOf(debugFixed)
  assert.equal(hotFixed.generation, hot3.generation + 1, 'recovery advances the generation')
  assert.equal(hotFixed.error, '', 'the error clears')
  console.log('fixed ui.js -> generation', hotFixed.generation)

  // 6. an explicit swap, and an idle check that nothing reloads on its own.
  const hotManual = hotOf((await getText('/debug?reload=1')).text)
  assert.equal(hotManual.generation, hotFixed.generation + 1, 'manual reload swaps once')
  await sleep(400)
  const idleA = hotOf((await getText('/debug')).text)
  await sleep(400)
  const idleB = hotOf((await getText('/debug')).text)
  assert.equal(idleB.generation, idleA.generation, 'no reload while nothing changes')
  assert.equal(idleB.reloads, idleA.reloads, 'the reload counter is stable')
  console.log('idle -> generation', idleB.generation, '| reloads', idleB.reloads)
  console.log('hot-test: ok, one listener, generation ' + idleB.generation + ' after ' + idleB.reloads + ' reloads')
} finally {
  for (const dispose of disposers) {
    try { dispose() } catch { /* nothing to do */ }
  }
  await sleep(50)
  if (cleanupRoot) await rm(root, { recursive: true, force: true })
}
process.exit(0)
