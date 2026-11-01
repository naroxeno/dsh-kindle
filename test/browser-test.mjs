/**
 * End-to-end check of the incremental poller in a real engine.
 *
 * The page relies on inline JS that no unit test executes, and a single typo
 * (an undeclared variable) silently stops every update. So: run the plugin
 * against a fake session store, open the page with Chromium's virtual clock,
 * append a message after the load, and check that the DOM grew.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const B = new URL('../lib/', import.meta.url).href
const { apply } = await import(B + 'index.js')

const chromium = process.env.CHROMIUM || 'chromium'
try {
  await run(chromium, ['--version'])
} catch {
  console.log('browser test skipped: no chromium')
  process.exit(0)
}

const cwd = '/tmp/kindle-ws-browser'
let seq = 0
const events = []
const id = 'session-browser-1'
const title = '增量测试'

function push(type, data, surfaceOp) {
  seq += 1
  events.push({ type, seq, time: Date.now(), data, ...(surfaceOp ? { surfaceOp } : {}) })
}

push('user/message', { message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第一条消息' }] } }, 'append')

const session = {
  sessionId: id, cwd, running: true, blank: false, updatedAt: Date.now(),
  projections: { values: { title } },
}

// The page load reads the transcript once; the first /tail poll reads it
// again. Appending on that second read makes the test independent of wall
// clock and virtual clock drifting apart.
let reads = 0
function maybeAppend() {
  reads += 1
  if (reads === 2) {
    push('assistant/message', {
      message: { role: 'assistant', content: [{ type: 'text', text: '第二条消息（页面加载之后才出现）' }] },
      interrupted: false,
    }, 'append')
    session.running = false
    session.updatedAt = Date.now()
  }
}

const sessionController = {
  async list() { return { items: [session] } },
  async events() {
    maybeAppend()
    const records = events.map((event) => ({ type: 'event', event }))
    return { cursor: events.length - 1, records, hasMore: false }
  },
  async resolveAgent() { return { agent: { id, ctx: { systemPrompt: { section() {} } } } } },
  async prompt() { return { accepted: true } },
}

const disposers = []
const ctx = {
  logger: () => ({ info() {}, error() {}, warn() {} }),
  effect: (fn) => { disposers.push(fn()) },
  sessionController,
  inject: (deps, callback) => callback(ctx),
  workspaceRegistry: { archivedSessionIds: [] },
  workspaceController: { async archiveSession() { return {} } },
}
apply(ctx, { host: '127.0.0.1', port: 8093, cwd, token: 'secret', fontSize: 30, pageSize: 6 })
await new Promise((r) => setTimeout(r, 300))

const url = `http://127.0.0.1:8093/c/${id}?t=secret`
const { stdout } = await run(chromium, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--virtual-time-budget=15000', '--dump-dom', url,
], { maxBuffer: 32 * 1024 * 1024, timeout: 60000 })

const first = stdout.includes('第一条消息')
const appended = stdout.includes('第二条消息（页面加载之后才出现）')
const msgs = (stdout.match(/class="msg /g) || []).length
console.log('browser: first message ->', first)
console.log('browser: appended after load ->', appended)
console.log('browser: message blocks ->', msgs)

for (const dispose of disposers) dispose()
if (!first || !appended) {
  console.error('FAIL: incremental refresh did not append new content')
  process.exit(1)
}
