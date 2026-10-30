/**
 * Thin adapter over `ctx.sessionController` for the Kindle client.
 *
 * The client is stateless: every page render reconstructs the transcript from
 * the durable Session log (`inspect`, which never activates an Agent) and the
 * list (`list`, for titles and run state).
 */
import { randomUUID } from 'node:crypto'

const SURFACE_TYPES = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])

/**
 * Every host call needs a live AbortSignal: the controller implementation
 * calls `signal.throwIfAborted()`, so `undefined` turns into a 500.
 */
function signalFor(ms) {
  return AbortSignal.timeout(ms)
}

/**
 * Sessions that belong to this UI: everything whose cwd is the Kindle
 * workspace.
 */
export async function listSessions(ctx, cwd) {
  const value = await sessions().list({}, signalFor(15000))
  const items = Array.isArray(value?.items) ? value.items : []
  const archived = archivedSet(ctx)
  return items
    // Subagent Sessions are internal work; a **forked** Session keeps its
    // parentSessionId but is a real, user-visible conversation.
    .filter((item) => item.origin !== 'subagent')
    .filter((item) => !archived || !archived.has(item.sessionId))
    .filter((item) => !cwd || item.cwd === cwd)
    .map((item) => ({
      sessionId: item.sessionId,
      title: titleOf(item) || '（未命名会话）',
      updatedAt: Number(item.updatedAt) || 0,
      running: item.running === true,
      blank: item.blank === true,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function titleOf(item) {
  const values = item?.projections?.values
  const title = values && typeof values.title === 'string' ? values.title.trim() : ''
  return title
}

export async function createSession(ctx, cwd) {
  const value = await sessions().create(cwd ? { cwd } : {})
  if (!value || !value.sessionId) throw new Error('create() returned no sessionId')
  return String(value.sessionId)
}

/**
 * Send one prompt. `text` already carries TeX where the user typed formulas.
 */
export async function sendPrompt(ctx, sessionId, text) {
  await sessions().prompt({
    requestId: randomUUID(),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  }, signalFor(30000))
}

/**
 * Sessions archived from the Kindle list. The archive set lives in the Host's
 * workspace registry, so a session hidden from the Web GUI stays hidden here
 * (and vice versa) without duplicating any state.
 */
/** Ids archived from this process, in case the registry is not readable. */
const archivedLocally = new Set()

/**
 * Host services this module may call. `sessionController` is a hard dependency
 * of the plugin; the two workspace services are resolved in their own inject
 * scope, so a profile without the workspace extension still gets a usable
 * Kindle client (minus archiving).
 */
const host = { sessionController: null, workspaceController: null, workspaceRegistry: null, llm: null }

/** Attach or detach one host service. */
export function setHost(partial) {
  for (const key of Object.keys(partial)) host[key] = partial[key] || null
}

function sessions() {
  if (!host.sessionController) throw new Error('sessionController is not available yet')
  return host.sessionController
}

function archivedSet(ctx) {
  const merged = new Set(archivedLocally)
  try {
    const registry = host.workspaceRegistry
    const set = registry && registry.archivedSessionIds
    if (set && typeof set[Symbol.iterator] === 'function') {
      for (const id of set) merged.add(id)
    }
  } catch (error) {
    // Registry absent: fall back to what this process archived.
  }
  return merged
}

export async function renameSession(ctx, sessionId, title) {
  return sessions().rename({ sessionId, title: String(title || '') })
}

/** Fork at the latest completed turn; returns the new Session id. */
export async function forkSession(ctx, sessionId) {
  const value = await sessions().fork({ sessionId })
  if (!value || !value.sessionId) throw new Error('fork() returned no sessionId')
  return String(value.sessionId)
}

/** Give a fork a distinguishable title; best effort, the caller ignores failures. */
export async function labelFork(ctx, sourceId, forkedId, cwd) {
  const source = await sessionState(ctx, sourceId, cwd)
  const base = (source && source.title ? source.title : '').trim() || '（未命名会话）'
  const title = ('分叉：' + base).slice(0, 100)
  await sessions().rename({ sessionId: forkedId, title })
  return title
}

/** Hide one Session from the list. Files stay on disk; the GUI can restore it. */
export async function archiveSession(ctx, sessionId) {
  const workspace = host.workspaceController
  if (!workspace || typeof workspace.archiveSession !== 'function') {
    throw new Error('这个 Host 没有挂载 workspace 服务，无法删除会话。')
  }
  await workspace.archiveSession({ sessionId, stopActivity: true })
  archivedLocally.add(sessionId)
}

export async function cancelSession(ctx, sessionId) {
  await sessions().cancel({ sessionId })
}

/**
 * Run state only: cheap enough to poll from the device every few seconds.
 * @returns {Promise<{running: boolean, updatedAt: number, title: string} | null>}
 */
export async function sessionState(ctx, sessionId, cwd) {
  const sessions = await listSessions(ctx, cwd)
  const found = sessions.find((s) => s.sessionId === sessionId)
  if (!found) return null
  return { running: found.running, updatedAt: found.updatedAt, title: found.title }
}

/**
 * Rebuild the visible transcript of one Session.
 * @returns {Promise<{messages: Array<object>, running: boolean, updatedAt: number, title: string}>}
 */
export async function readTranscript(ctx, sessionId, cwd) {
  const state = await sessionState(ctx, sessionId, cwd)
  const inspection = await sessions().inspect(sessionId, signalFor(30000))
  const events = Array.isArray(inspection?.events) ? inspection.events : []

  const calls = new Map()
  for (const event of events) {
    if (event.type === 'tool/call') {
      const data = event.data || {}
      calls.set(String(data.callId), { name: String(data.name || 'tool'), args: String(data.arguments || '') })
    }
  }

  /** Surface entries survive `replace` rewrites, so track them by seq. */
  const surface = []
  let rewriteFloor = 0
  for (const event of events) {
    if (!SURFACE_TYPES.has(event.type)) continue
    const op = event.surfaceOp
    if (op && typeof op === 'object' && op.op === 'replace') {
      const start = Number(op.startSeq)
      const end = Number(op.endSeq)
      rewriteFloor = Math.max(rewriteFloor, start)
      for (let index = surface.length - 1; index >= 0; index -= 1) {
        const seq = surface[index].seq
        if (seq >= start && seq <= end) surface.splice(index, 1)
      }
    }
    surface.push(event)
  }
  surface.sort((a, b) => a.seq - b.seq)

  const messages = []
  for (const event of surface) {
    const data = event.data || {}
    if (event.type === 'user/message') {
      // Two payload shapes coexist in the durable log: `assistant`/`system`
      // messages nest the message under `data.message`, while `user/message`
      // carries it at the top level. Injected prompts (runtime context, skill
      // catalog) are logged as user messages too, so keep only real ones.
      const message = data.message || data
      const source = message && message.source ? String(message.source.kind || '') : ''
      if (source && source !== 'user') continue
      const text = textBlocks(message)
      if (text) messages.push({ kind: 'user', seq: event.seq, text })
      continue
    }
    if (event.type === 'assistant/message') {
      const text = textBlocks(data.message)
      if (text) messages.push({ kind: 'assistant', seq: event.seq, text, interrupted: data.interrupted === true })
      continue
    }
    if (event.type === 'tool/result') {
      const message = data.message || {}
      const call = calls.get(String(message.toolCallId))
      const text = textBlocks(message)
      messages.push({
        kind: 'tool',
        seq: event.seq,
        name: call ? call.name : 'tool',
        text,
        error: message.isError === true || Boolean(data.error),
      })
      continue
    }
  }

  return {
    messages,
    rewriteFloor,
    running: state ? state.running : false,
    updatedAt: state ? state.updatedAt : 0,
    title: state ? state.title : '',
  }
}

function textBlocks(message) {
  const content = message && Array.isArray(message.content) ? message.content : []
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    if (block && block.type === 'image') parts.push('[图片]')
    if (block && block.type === 'file') parts.push('[文件]')
  }
  return parts.join('\n').trim()
}


/**
 * Reasoning-effort selection.
 *
 * The catalog lists, per model route, the efforts that adapter accepts
 * (`low`/`high`/`max` for DeepSeek, none for models without reasoning). The
 * per-session choice lives in the `modelSelection` projection, so reading it
 * never resumes an Agent; setting it does, which is why the UI only offers
 * this on a session page.
 */
const catalogCache = { at: 0, value: null }
const CATALOG_TTL = 5 * 60 * 1000

export async function modelCatalog(ctx) {
  const now = Date.now()
  if (catalogCache.value && now - catalogCache.at < CATALOG_TTL) return catalogCache.value
  const value = await sessions().modelCatalog()
  catalogCache.at = now
  catalogCache.value = value
  return value
}

/**
 * Current route, its display name, and the efforts it accepts.
 * @returns {Promise<{provider: string, model: string, name: string,
 *   efforts: Array<{id: string, name: string, description?: string}>,
 *   current: string}>}
 */
export async function modelChoice(ctx, sessionId) {
  const catalog = await modelCatalog(ctx)
  const fallback = catalog.default || { provider: '', model: '' }
  let selection = fallback
  try {
    const value = await sessions().projections({ sessionId }, signalFor(10000))
    const view = value && value.values ? value.values.modelSelection : null
    if (view && view.next) selection = view.next
  } catch (error) {
    // A cold or migrated session may not expose projections; the deployment
    // default is still the right thing to show.
  }

  const group = (catalog.groups || []).find((entry) => entry.id === selection.provider)
  const model = group && (group.models || []).find((entry) => entry.id === selection.model)
  const reasoning = model && model.reasoning

  // The model catalog is advisory and several adapters leave `reasoning` out of
  // it entirely; the adapter that owns the route is the only reliable source
  // for the effort levels it will accept.
  const info = await modelCapabilities(ctx, selection.provider, selection.model)
  const resolved = info && info.reasoning
  const catalogEfforts = Array.isArray(reasoning && reasoning.efforts) ? reasoning.efforts : []
  const efforts = Array.isArray(resolved && resolved.efforts) && resolved.efforts.length > 0
    ? resolved.efforts
    : catalogEfforts
  const current =
    selection.reasoningEffort ||
    (resolved && resolved.defaultEffort) ||
    (reasoning && reasoning.defaultEffort) ||
    ''
  return {
    provider: selection.provider,
    model: selection.model,
    name: (model && model.name) || (info && info.name) || selection.model,
    efforts,
    current,
  }
}

/** Install one effort on the session's current route. */
export async function setReasoningEffort(ctx, sessionId, effort) {
  const chosen = await modelChoice(ctx, sessionId)
  await sessions().selectModel({
    sessionId,
    provider: chosen.provider,
    model: chosen.model,
    reasoningEffort: effort,
  })
  return { ...chosen, current: effort }
}

/** Per-route capability lookups (the catalog omits reasoning for some adapters). */
const infoCache = new Map()

async function modelCapabilities(ctx, provider, model) {
  const llm = host.llm
  if (!llm || typeof llm.resolveModelInfo !== 'function' || !provider || !model) return null
  const key = `${provider}/${model}`
  const hit = infoCache.get(key)
  if (hit && Date.now() - hit.at < CATALOG_TTL) return hit.value
  try {
    const info = await llm.resolveModelInfo(provider, model)
    if (infoCache.size > 20) infoCache.clear()
    infoCache.set(key, { at: Date.now(), value: info })
    return info
  } catch (error) {
    return null
  }
}

/** Test hook: forget the cached catalog. */
export function clearCatalogCache() {
  catalogCache.at = 0
  catalogCache.value = null
  infoCache.clear()
}
