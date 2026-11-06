import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const B = new URL('../lib/', import.meta.url).href + '/'
const { apply } = await import(B + 'index.js')

const cwd = mkdtempSync(join(tmpdir(), 'kindle-ws-test-'))
let seq = 0
const store = new Map()

function mkSession(id, path = cwd) {
  return { sessionId: id, cwd: path, running: false, blank: true, updatedAt: Date.now(), projections: { values: { title: null } }, events: [] }
}
function append(s, type, data, surfaceOp) {
  seq += 1
  s.events.push({ type, seq, time: Date.now(), data, ...(surfaceOp ? { surfaceOp } : {}) })
  s.updatedAt = Date.now()
  s.blank = false
}

const workspaces = new Map()
const createRequests = []

function workspaceEntity(record) {
  return {
    id: record.id,
    path: record.path,
    title: record.title,
    get sessionIds() { return [...record.sessionIds] },
    async attachSession(sessionId) {
      const session = store.get(sessionId)
      if (!session || session.cwd !== record.path) throw new Error('session cwd does not match workspace')
      if (!record.sessionIds.includes(sessionId)) record.sessionIds.unshift(sessionId)
    },
  }
}

const sessionController = {
  async list() {
    return { items: [...store.values()].map((s) => ({
      sessionId: s.sessionId, cwd: s.cwd, running: s.running, blank: s.blank,
      updatedAt: s.updatedAt, projections: s.projections,
      parentSessionId: s.parentSessionId, origin: s.origin,
    })) }
  },
  async create(req) {
    createRequests.push(req)
    if (req.workspaceId !== undefined && req.cwd !== undefined) throw new Error('workspaceId and cwd are exclusive')
    const id = 'sess-' + Math.random().toString(36).slice(2, 8)
    const session = mkSession(id)
    if (req.workspaceId) {
      const record = workspaces.get(req.workspaceId)
      if (!record) throw new Error('no such workspace')
      session.cwd = record.path
      record.sessionIds.unshift(id)
    } else if (req.cwd) {
      session.cwd = req.cwd
    }
    store.set(id, session)
    return { sessionId: id }
  },
  async prompt(req) {
    const s = store.get(req.sessionId)
    const text = req.content.map((p) => p.text).join('')
    append(s, 'user/message', { message: { role: 'user', content: [{ type: 'text', text }] } }, 'append')
    s.running = true
    setTimeout(() => {
      append(s, 'assistant/message', {
        message: { role: 'assistant', content: [{ type: 'text', text: '收到：$\\sqrt{2}$ 大约 1.414\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$' }] },
        interrupted: false,
      }, 'append')
      s.running = false
      append(s, 'turn/end', {})
    }, 60)
    return { accepted: true }
  },
  async rename(req) {
    const s = store.get(req.sessionId)
    s.projections = { values: { title: req.title } }
    return { title: req.title, seq: ++seq }
  },
  async fork(req) {
    const src = store.get(req.sessionId)
    const id = 'fork-' + Math.random().toString(36).slice(2, 8)
    const copy = mkSession(id, src.cwd)
    copy.events = src.events.map((e) => ({ ...e }))
    copy.blank = false
    copy.parentSessionId = src.sessionId
    store.set(id, copy)
    return { sessionId: id }
  },
  async cancel(req) { store.get(req.sessionId).running = false; return {} },
  async resolveAgent(id) {
    if (!agents.has(id)) agents.set(id, { id, ctx: { systemPrompt: { section: (s) => sections.push({ ...s, sessionId: id }) } } })
    return { agent: agents.get(id) }
  },
  async events(req) {
    const s = store.get(req.address.sessionId)
    if (!s) throw new Error('no session')
    const end = req.beforeSeq === undefined ? s.events.length : req.beforeSeq
    const max = Math.min(req.maxMessages === undefined ? 50 : req.maxMessages, 2)
    let cut = 0
    let count = 0
    for (let i = end - 1; i >= 0; i -= 1) {
      const event = s.events[i]
      if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
      count += 1
      if (count >= max) { cut = i; break }
    }
    const records = s.events.slice(cut, end).map((event) => ({ type: 'event', event }))
    return { cursor: end - 1, records, hasMore: cut > 0 }
  },
  async modelCatalog() {
    return {
      default: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
      routableProviders: ['deepseek-official'],
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-flash', name: 'deepseek-flash' }],
      }],
      failures: [],
    }
  },
  async projections(req) {
    const s = store.get(req.sessionId)
    const selection = s && s.selection ? s.selection : null
    return { kind: 'sequenced', asOfSeq: seq, values: { modelSelection: { lastUsed: null, pending: selection } } }
  },
  async selectModel(req) {
    const s = store.get(req.sessionId)
    s.selection = { provider: req.provider, model: req.model, reasoningEffort: req.reasoningEffort }
    return { selected: s.selection }
  },
}

const agents = new Map()
const sections = []
const archived = new Set()

const disposers = []
const ctx = {
  logger: (n) => ({ info: (m) => console.log('[log]', m), error: (m) => console.log('[err]', m) }),
  effect: (fn) => { disposers.push(fn()) },
  sessionController,
  llm: {
    async resolveModelInfo(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        context: { contextWindow: 128000 },
        reasoning: {
          efforts: [
            { id: 'off', name: 'Off' },
            { id: 'low', name: 'Low' },
            { id: 'high', name: 'High' },
            { id: 'max', name: 'Max' },
          ],
          defaultEffort: 'max',
        },
      }
    },
  },
  inject: (deps, callback) => callback(ctx),
  workspaceRegistry: {
    get archivedSessionIds() { return [...archived] },
    get(id) { const record = workspaces.get(id); return record && workspaceEntity(record) },
    list() { return [...workspaces.values()].map(workspaceEntity) },
    async resolveByPath(path) {
      for (const record of workspaces.values()) if (record.path === path) return workspaceEntity(record)
      return undefined
    },
    async create(path, title) {
      for (const record of workspaces.values()) {
        if (record.path === path) return workspaceEntity(record)
      }
      const record = { id: 'ws-' + (workspaces.size + 1), path, title: title || '', sessionIds: [] }
      workspaces.set(record.id, record)
      return workspaceEntity(record)
    },
  },
  accountController: {
    async getState() {
      return {
        status: 'credential-stored',
        links: { usageUrl: 'https://platform.example/usage', topUpUrl: 'https://platform.example/topup' },
        attempt: null,
      }
    },
    async getBalance(client) {
      if (!client || typeof client.timezoneOffsetSeconds !== 'number') throw new Error('client metadata required')
      return {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '12.34' }],
        bonusWallets: [{ currency: 'CNY', balance: '2.00' }],
      }
    },
  },
  workspaceController: {
    async archiveSession(request) {
      archived.add(request.sessionId)
      return { archivedSessionIds: [...archived] }
    },
  },
}
// A subagent Session lives in the same workspace but is internal work; it must
// never show up in the list (only forked Sessions keep a parentSessionId *and* stay visible).
const subagentSession = mkSession('sub-1')
subagentSession.origin = 'subagent'
subagentSession.parentSessionId = 'sess-parent'
subagentSession.projections = { values: { title: '子代理' } }
store.set('sub-1', subagentSession)

apply(ctx, { host: '127.0.0.1', port: 8091, cwd, token: 'secret', fontSize: 30, pageSize: 6 })
await new Promise((r) => setTimeout(r, 300))

const base = 'http://127.0.0.1:8091'
async function req(path, opts = {}) {
  const res = await fetch(base + path, { redirect: opts.redirect || 'manual', ...opts })
  const text = await res.text()
  return { status: res.status, headers: res.headers, text }
}

function checkHtmlHeaders(label, response) {
  try {
    assert.match(response.headers.get('content-type') || '', /^text\/html; charset=utf-8$/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('connection'), 'close')
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(response.text))
    console.log('30 HTML headers ->', label, 'ok')
  } catch (error) {
    console.error('30 HTML headers ->', label, error.message)
    process.exitCode = 1
  }
}

const noauth = await req('/s')
console.log('1 unauth /s ->', noauth.status, /需要访问令牌/.test(noauth.text))

const login = await req('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=secret&next=%2Fs' })
console.log('2 login ->', login.status, login.headers.get('set-cookie') ? 'cookie set' : 'no cookie')
const cookie = 'kd=secret'

const list0 = await req('/s', { headers: { cookie } })
console.log('3 list ->', list0.status, /还没有会话/.test(list0.text))
checkHtmlHeaders('list page', list0)

const created = await req('/new', { method: 'POST', headers: { cookie } })
const loc = created.headers.get('location')
console.log('4 create ->', created.status, loc)
const id = loc.split('/').pop()

const page0 = await req('/c/' + id, { headers: { cookie } })
console.log('5 session page ->', page0.status, 'len', page0.text.length, 'textarea', /name="msg"/.test(page0.text))
checkHtmlHeaders('session page', page0)

console.log('6 prompt ->', sections.length, JSON.stringify(sections[0] && { name: sections[0].name, order: sections[0].order }), 'bytes', sections[0] ? sections[0].text.length : 0)

const prev = await req(`/c/${id}/preview`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'msg=' + encodeURIComponent('求 $frac{1}{2}$ 与 $sqrt(x)$') })
console.log('7 preview ->', prev.status, 'svgs', (prev.text.match(/<svg/g) || []).length)

const sent = await req(`/c/${id}/send`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'msg=' + encodeURIComponent('计算 $int_0^1 x^2 dx$') })
console.log('8 send ->', sent.status, sent.headers.get('location'))

await new Promise((r) => setTimeout(r, 200))
const st = await req(`/c/${id}/state`, { headers: { cookie } })
console.log('9 state ->', st.status, JSON.stringify(st.text))

const page1 = await req('/c/' + id, { headers: { cookie } })
console.log('10 page after ->', page1.status, 'svgs', (page1.text.match(/<svg/g) || []).length, 'user bubble', page1.text.includes('class="msg u"'), 'assistant bubble', page1.text.includes('class="msg a"'))
console.log('11 title/list ->', (await req('/s', { headers: { cookie } })).text.includes(id))
console.log('12 debug ->', (await req('/debug', { headers: { cookie } })).text.trim())

// --- incremental refresh (/tail) ---
const tail0 = JSON.parse((await req(`/c/${id}/tail?since=0`, { headers: { cookie } })).text)
console.log('18 tail init ->', tail0.mode, 'cursor', tail0.cursor, 'has u', tail0.html.includes('class="msg u"'), 'running', tail0.running)

const tail1 = JSON.parse((await req(`/c/${id}/tail?since=${tail0.cursor}`, { headers: { cookie } })).text)
console.log('19 tail idle ->', tail1.mode, 'html len', tail1.html.length)

await req(`/c/${id}/send`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'msg=' + encodeURIComponent('再问一句') })
const tail2 = JSON.parse((await req(`/c/${id}/tail?since=${tail0.cursor}`, { headers: { cookie } })).text)
console.log('20 tail append ->', tail2.mode, 'has u', tail2.html.includes('class="msg u"'), 'cursor moved', tail2.cursor > tail0.cursor)

const live = store.get(id)
append(live, 'tool/result', { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'x' }] } }, { op: 'replace', startSeq: 2, endSeq: 3 })
const tail3 = JSON.parse((await req(`/c/${id}/tail?since=${tail2.cursor}`, { headers: { cookie } })).text)
console.log('21 tail rewrite ->', tail3.mode)

const renamePage = await req(`/c/${id}/rename`, { headers: { cookie } })
console.log('13 rename page ->', renamePage.status, renamePage.text.includes('name="title"'))
checkHtmlHeaders('rename page', renamePage)

const renamed = await req(`/c/${id}/rename`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'title=' + encodeURIComponent('改过的标题') })
console.log('14 rename post ->', renamed.status, (await req('/s', { headers: { cookie } })).text.includes('改过的标题'))

const forked = await req(`/c/${id}/fork`, { method: 'POST', headers: { cookie } })
const forkId = (forked.headers.get('location') || '').split('/').pop()
const listAfterFork = (await req('/s', { headers: { cookie } })).text
console.log('15 fork ->', forked.status, forkId, listAfterFork.includes(forkId), 'titled', listAfterFork.includes('分叉：'))

const delPage = await req(`/c/${id}/delete`, { headers: { cookie } })
console.log('16 delete page ->', delPage.status, delPage.text.includes('删除这个会话？'))
checkHtmlHeaders('delete page', delPage)

const deleted = await req(`/c/${id}/delete`, { method: 'POST', headers: { cookie } })
const afterList = (await req('/s', { headers: { cookie } })).text
console.log('17 delete post ->', deleted.status, 'gone', !afterList.includes(id), 'fork kept', afterList.includes(forkId))

// --- balance and reasoning effort ---
const listBal = (await req('/s', { headers: { cookie } })).text
console.log('22 list balance ->', listBal.includes('¥12.34'), 'account link', listBal.includes('href="/me"'))

const me = await req('/me', { headers: { cookie } })
checkHtmlHeaders('account page', me)
console.log('23 account page ->', me.status, 'balance', me.text.includes('¥12.34'), 'bonus', me.text.includes('¥2.00'), 'links',
  me.text.includes('https://platform.example/usage') && me.text.includes('https://platform.example/topup'))

const forkPage = await req('/c/' + forkId, { headers: { cookie } })
console.log('27 fork page ->', forkPage.status, 'bubbles', /class="msg (u|a)"/.test(forkPage.text))
const effortButtons = (forkPage.text.match(/class="mini(?: on)?"/g) || []).length
console.log('24 effort bar ->', forkPage.status, 'bar', forkPage.text.includes('class="modelbar"'),
  'labels', forkPage.text.includes('关') && forkPage.text.includes('低') && forkPage.text.includes('最大'),
  'four', effortButtons === 4,
  'current', /class="mini on" disabled>最大</.test(forkPage.text))

const setHigh = await req(`/c/${forkId}/effort`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'effort=high',
})
console.log('25 effort post ->', setHigh.status, 'stored', store.get(forkId).selection && store.get(forkId).selection.reasoningEffort)

const badEffort = await req(`/c/${forkId}/effort`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'effort=nonsense',
})
console.log('26 effort guard ->', badEffort.status)

const effortShown = (await req('/c/' + forkId, { headers: { cookie } })).text
console.log('29 effort shown ->', /class="mini on" disabled>高</.test(effortShown))

const listAfter = (await req('/s', { headers: { cookie } })).text
console.log('28 subagent hidden ->', !listAfter.includes('sub-1'))

// --- grouping and search ---
const created2 = await req('/new', {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'preset=standard',
})
const id2 = (created2.headers.get('location') || '').split('/').pop()
const group = [...workspaces.values()][0]
const lastRequest = createRequests[createRequests.length - 1]
console.log('31 grouped create ->', created2.status, 'workspaceId passed', Boolean(lastRequest.workspaceId),
  'no cwd', lastRequest.cwd === undefined, 'attached', group && group.sessionIds.includes(id2))

const settingsPage = await req('/settings', { headers: { cookie } })
console.log('32 settings page ->', settingsPage.status, 'registered', settingsPage.text.includes('已注册'),
  'path field', settingsPage.text.includes('name="path"'), 'file', settingsPage.text.includes('.kindle-settings.json'))
checkHtmlHeaders('settings page', settingsPage)

await req(`/c/${id2}/rename`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'title=' + encodeURIComponent('苹果笔记') })
await req(`/c/${forkId}/rename`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'title=' + encodeURIComponent('香蕉草图') })
const searchPost = await req('/s', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'q=' + encodeURIComponent('苹果') })
const searchHref = searchPost.headers.get('location') || ''
const searchGet = (await req(searchHref, { headers: { cookie } })).text
console.log('33 search ->', searchPost.status, searchHref, 'hit', searchGet.includes('苹果笔记'),
  'miss', !searchGet.includes('香蕉草图'), 'refilled', searchGet.includes('value="苹果"'),
  'clear', searchGet.includes('清除搜索'))

const saved = await req('/settings', {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'action=save&path=' + encodeURIComponent(cwd),
})
const savedPage = (await req('/settings?ok=saved', { headers: { cookie } })).text
console.log('34 save settings ->', saved.status, saved.headers.get('location'), 'notice', savedPage.includes('默认工作区已保存'))

const stray = mkSession('stray-1')
store.set('stray-1', stray)
const adopted = await req('/settings', {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'action=adopt',
})
console.log('35 adopt old session ->', adopted.status, adopted.headers.get('location'), 'attached',
  group && group.sessionIds.includes('stray-1'), 'listed', (await req('/s', { headers: { cookie } })).text.includes('stray-1'))

for (const d of disposers) d()
