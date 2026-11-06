/**
 * Integration test against the real cordis runtime and a stub session
 * controller: proves the plugin activates with only `sessionController`
 * injected, that the workspace services arrive through the optional inject
 * scope, and that archive (delete) works end to end.
 *
 * Needs the cordis package from the DSH installation; override with
 * DSH_CORDIS=/path/to/cordis/lib/index.js when it lives elsewhere.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CORDIS = process.env.DSH_CORDIS || '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'

let cordis
try {
  cordis = await import(CORDIS)
} catch (error) {
  console.log('SKIP integration-test: cordis not found at', CORDIS)
  process.exit(0)
}

const { Context, Service } = cordis
const plugin = await import(`../lib/index.js?v=${Date.now()}`)

const cwd = mkdtempSync(join(tmpdir(), 'kindle-ws-'))
const archived = new Set()
const items = [
  { sessionId: 'session-x1', updatedAt: 2, running: false, blank: false, cwd, projections: { values: { title: 'a' } } },
  { sessionId: 'session-x2', updatedAt: 1, running: false, blank: false, cwd, projections: { values: { title: 'b' } } },
]

const createRequests = []
class FakeSessions extends Service {
  constructor(ctx) { super(ctx, 'sessionController') }
  async list() { return { items } }
  async create(request) { createRequests.push(request); return { sessionId: 'session-new' } }
  async prompt() { return { accepted: true } }
  async events() { return { cursor: 0, records: [], hasMore: false } }
  async cancel() { return {} }
  async rename() { return { title: 'x', seq: 1 } }
  async fork() { return { sessionId: 'session-fork' } }
  async resolveAgent() { return { agent: null } }
}
class FakeRegistry extends Service {
  constructor(ctx) {
    super(ctx, 'workspaceRegistry')
    this.records = new Map()
  }
  get archivedSessionIds() { return [...archived] }
  get(id) { return this.records.get(id) }
  list() { return [...this.records.values()] }
  async resolveByPath(path) { return this.list().find((record) => record.path === path) }
  async create(path, title) {
    const found = await this.resolveByPath(path)
    if (found) return found
    const record = {
      id: 'ws-' + (this.records.size + 1),
      path,
      title: title || '',
      sessionIds: [],
      async attachSession(sessionId) { record.sessionIds.unshift(sessionId) },
    }
    this.records.set(record.id, record)
    return record
  }
}
class FakeWorkspace extends Service {
  constructor(ctx) { super(ctx, 'workspaceController') }
  async archiveSession(request) { archived.add(request.sessionId) }
}

const root = new Context()
root.plugin(FakeSessions, {})
root.plugin(FakeRegistry, {})
root.plugin(FakeWorkspace, {})
root.plugin(plugin, { host: '127.0.0.1', port: 8092, cwd, token: 'sekrit', fontSize: 30, pageSize: 6 })
await new Promise((r) => setTimeout(r, 800))

const base = 'http://127.0.0.1:8092'
const headers = { cookie: 'kd=sekrit' }
const debug = await (await fetch(`${base}/debug`, { headers })).text()
const list = await fetch(`${base}/s`, { headers, redirect: 'manual' })
const listText = await list.text()
const del = await fetch(`${base}/c/session-x1/delete`, { method: 'POST', headers, redirect: 'manual' })
const created = await fetch(`${base}/new`, { method: 'POST', headers, redirect: 'manual' })
const settings = await fetch(`${base}/settings`, { headers, redirect: 'manual' })
const settingsText = await settings.text()
const after = await (await fetch(`${base}/s`, { headers })).text()

console.log('1 plugin active + version ->', /^kindle-ui \d+\.\d+\.\d+$/.test(debug.split('\n')[0]))
console.log('2 workspace services ready ->', debug.includes('ready'))
console.log('3 list 200 ->', list.status === 200, 'x1 listed ->', listText.includes('session-x1'))
console.log('4 connection close ->', list.headers.get('connection') === 'close')
console.log('5 delete 303 ->', del.status === 303, del.headers.get('location'))
console.log('6 x1 archived in host ->', archived.has('session-x1'))
console.log('7 x1 gone, x2 kept ->', !after.includes('session-x1'), after.includes('session-x2'))
const lastCreate = createRequests[createRequests.length - 1] || {}
const record = debug.includes('workspaces: registered')
console.log('8 create is grouped ->', created.status, 'workspaceId', Boolean(lastCreate.workspaceId),
  'no cwd', lastCreate.cwd === undefined)
console.log('9 registry ->', record, 'attached', (createRequests.length > 0))
console.log('10 settings page ->', settings.status, 'path field', settingsText.includes('name="path"'),
  'workspace shown', settingsText.includes(cwd))
process.exit(0)
