import { randomUUID } from 'node:crypto'

import type {
  KindleContext,
  KindleServices,
  LlmLike,
  ModelCatalog,
  ModelChoice,
  ModelInfo,
  ReasoningEffort,
  SessionControllerLike,
  SessionCreateOptions,
  SessionEvent,
  SessionEventPage,
  SessionListItem,
  SessionMessage,
  WorkspaceControllerLike,
  WorkspaceEntityLike,
  WorkspaceRegistryLike,
} from './host.js'

export interface SessionListEntry {
  sessionId: string
  title: string
  updatedAt: number
  running: boolean
  blank: boolean
}

export interface SessionState {
  running: boolean
  updatedAt: number
  title: string
}

export interface TranscriptMessage {
  kind: 'user' | 'assistant' | 'tool'
  seq: number
  text: string
  interrupted?: boolean
  name?: string
  error?: boolean
}

export interface Transcript {
  messages: TranscriptMessage[]
  rewriteFloor: number
  running: boolean
  updatedAt: number
  title: string
}

interface ToolCall {
  name: string
  args: string
}

interface HostServices {
  sessionController: SessionControllerLike | null
  workspaceController: WorkspaceControllerLike | null
  workspaceRegistry: WorkspaceRegistryLike | null
  llm: LlmLike | null
  [key: string]: unknown
}

const SURFACE_TYPES = new Set<string>([
  'system/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

function signalFor(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

export async function listSessions(ctx: KindleContext, cwd?: string): Promise<SessionListEntry[]> {
  const value = await sessions().list({}, signalFor(15000))
  const items = Array.isArray(value?.items) ? value.items : []
  const archived = archivedSet(ctx)
  return items
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

function titleOf(item?: SessionListItem): string {
  const values = item?.projections?.values
  const title = values && typeof values.title === 'string' ? values.title.trim() : ''
  return title
}

export async function createSession(
  ctx: KindleContext,
  options: SessionCreateOptions = {},
): Promise<string> {
  // The Host rejects `workspaceId` together with `cwd`, so pick one: a
  // workspace resolves its own path and attaches the session to the group.
  const request: SessionCreateOptions = {}
  if (options.workspaceId) request.workspaceId = options.workspaceId
  else if (options.cwd) request.cwd = options.cwd
  if (options.agentPreset) request.agentPreset = options.agentPreset
  const value = await sessions().create(request)
  if (!value || !value.sessionId) throw new Error('create() returned no sessionId')
  return String(value.sessionId)
}

/**
 * A registered workspace as the Kindle UI needs it. `sessionIds` is a snapshot:
 * the live entity derives it from the session cwds, and old Kindle sessions
 * created before grouping existed are absent until `adoptWorkspaceSessions`.
 */
export interface WorkspaceEntry {
  id: string
  path: string
  title: string
  sessionIds: string[]
}

function toWorkspaceEntry(entity: WorkspaceEntityLike): WorkspaceEntry {
  let sessionIds: string[] = []
  try {
    sessionIds = entity.sessionIds ? Array.from(entity.sessionIds).map(String) : []
  } catch (error) {}
  return {
    id: String(entity.id),
    path: String(entity.path || ''),
    title: String(entity.title || ''),
    sessionIds,
  }
}

/** All registered workspaces, or null when the Host has no workspace service. */
export async function listWorkspaces(): Promise<WorkspaceEntry[] | null> {
  const store = host.workspaceRegistry
  if (!store || typeof store.list !== 'function') return null
  try {
    const value = store.list()
    return Array.isArray(value) ? value.map(toWorkspaceEntry) : []
  } catch (error) {
    return null
  }
}

/**
 * Returns the workspace registered for `path`, registering the directory on
 * first use. Returns null when the Host cannot group at all; session creation
 * then falls back to `cwd`, which the GUI shows as「未分组」.
 */
export async function ensureWorkspace(path: string): Promise<WorkspaceEntry | null> {
  const store = host.workspaceRegistry
  if (!store || typeof store.create !== 'function') return null
  const found = typeof store.resolveByPath === 'function' ? await store.resolveByPath(path) : null
  if (found) return toWorkspaceEntry(found)
  return toWorkspaceEntry(await store.create(path))
}

/**
 * Attaches sessions that live in the workspace's directory but predate it.
 * Returns how many were newly attached; sessions already in the group are
 * skipped, and a rejected attach (different cwd) is ignored.
 */
export async function adoptWorkspaceSessions(
  workspaceId: string,
  sessionIds: string[],
): Promise<number> {
  const store = host.workspaceRegistry
  const entity = store && typeof store.get === 'function' ? store.get(workspaceId) : undefined
  if (!entity || typeof entity.attachSession !== 'function') return 0
  const have = new Set(toWorkspaceEntry(entity).sessionIds)
  let adopted = 0
  for (const sessionId of sessionIds) {
    if (have.has(sessionId)) continue
    try {
      await entity.attachSession(sessionId)
      have.add(sessionId)
      adopted += 1
    } catch (error) {}
  }
  return adopted
}

export interface AgentPresetEntry {
  id: string
  name: string
  description: string
  broken: string
}

export interface AgentPresetRoster {
  presets: AgentPresetEntry[]
  defaultId: string
}

/**
 * Display copy for the presets DSH ships with. The registry hands back ids
 * only; the names and one-line descriptions live in the web client's locale
 * bundle, so the Kindle page carries its own short version.
 */
const BUILT_IN_PRESET_COPY: Record<string, { name: string; description: string }> = {
  standard: {
    name: '标准模式',
    description: '处理代码、文件和资料，按需调用检索与终端。',
  },
  ptc: {
    name: 'PTC 模式',
    description: '标准模式全部能力，适合批量调工具再整理结果。',
  },
  minimal: {
    name: '极简模式',
    description: '只用终端和图片读取，适合测试基础表现。',
  },
  cordis: {
    name: '创造模式',
    description: '用对话定制 DSH，让 Agent 写插件、组合出自己的模式。',
  },
}

interface PresetRegistryLike {
  list(): Promise<Array<{ id?: unknown; name?: unknown; description?: unknown; broken?: unknown }>>
  defaultId?: string
}

/**
 * Reads the deployment's Agent preset roster (the 「会话模式」 a new session can
 * run). Returns null when the deployment composes no preset registry, in which
 * case session creation keeps its single default.
 */
export async function agentPresetRoster(ctx: KindleContext): Promise<AgentPresetRoster | null> {
  const registry = (ctx as unknown as { get?: (name: string) => unknown }).get?.('agentPresets') as
    PresetRegistryLike | undefined
  if (!registry || typeof registry.list !== 'function') return null
  const items = await registry.list()
  const presets: AgentPresetEntry[] = []
  for (const item of items || []) {
    const id = String(item.id || '')
    if (!id) continue
    const copy = BUILT_IN_PRESET_COPY[id]
    presets.push({
      id,
      name: String(item.name || (copy ? copy.name : id)),
      description: String(item.description || (copy ? copy.description : '')),
      broken: String(item.broken || ''),
    })
  }
  return { presets, defaultId: String(registry.defaultId || '') }
}

export async function sendPrompt(
  ctx: KindleContext,
  sessionId: string,
  text: string,
): Promise<void> {
  await sessions().prompt(
    {
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    },
    signalFor(30000),
  )
}

const archivedLocally = new Set<string>()

const host: HostServices = {
  sessionController: null,
  workspaceController: null,
  workspaceRegistry: null,
  llm: null,
}

export function setHost(partial: Partial<KindleServices>) {
  const store: Record<string, unknown> = host
  for (const key of Object.keys(partial) as Array<keyof KindleServices>) {
    store[key] = partial[key] || null
  }
}

function sessions(): SessionControllerLike {
  if (!host.sessionController) throw new Error('sessionController is not available yet')
  return host.sessionController
}

function archivedSet(ctx: KindleContext): Set<string> {
  const merged = new Set(archivedLocally)
  try {
    const registry = host.workspaceRegistry
    const set = registry && registry.archivedSessionIds
    if (set && typeof set[Symbol.iterator] === 'function') {
      for (const id of set) merged.add(id)
    }
  } catch (error) {}
  return merged
}

export async function renameSession(
  ctx: KindleContext,
  sessionId: string,
  title: string,
): Promise<unknown> {
  return sessions().rename({ sessionId, title: String(title || '') })
}

export async function forkSession(ctx: KindleContext, sessionId: string): Promise<string> {
  const value = await sessions().fork({ sessionId })
  if (!value || !value.sessionId) throw new Error('fork() returned no sessionId')
  return String(value.sessionId)
}

export async function labelFork(
  ctx: KindleContext,
  sourceId: string,
  forkedId: string,
  cwd?: string,
): Promise<string> {
  const source = await sessionState(ctx, sourceId, cwd)
  const base = (source && source.title ? source.title : '').trim() || '（未命名会话）'
  const title = ('分叉：' + base).slice(0, 100)
  await sessions().rename({ sessionId: forkedId, title })
  return title
}

export async function archiveSession(ctx: KindleContext, sessionId: string): Promise<void> {
  const workspace = host.workspaceController
  if (!workspace || typeof workspace.archiveSession !== 'function') {
    throw new Error('这个 Host 没有挂载 workspace 服务，无法删除会话。')
  }
  await workspace.archiveSession({ sessionId, stopActivity: true })
  archivedLocally.add(sessionId)
}

export async function cancelSession(ctx: KindleContext, sessionId: string): Promise<void> {
  await sessions().cancel({ sessionId })
}

export async function sessionState(
  ctx: KindleContext,
  sessionId: string,
  cwd?: string,
): Promise<SessionState | null> {
  const sessions = await listSessions(ctx, cwd)
  const found = sessions.find((s) => s.sessionId === sessionId)
  if (!found) return null
  return { running: found.running, updatedAt: found.updatedAt, title: found.title }
}

export async function readTranscript(
  ctx: KindleContext,
  sessionId: string,
  cwd?: string,
): Promise<Transcript> {
  const state = await sessionState(ctx, sessionId, cwd)
  const events = await sessionEvents(sessionId)

  const calls = new Map<string, ToolCall>()
  for (const event of events) {
    if (event.type === 'tool/call') {
      const data = event.data || {}
      calls.set(String(data.callId), {
        name: String(data.name || 'tool'),
        args: String(data.arguments || ''),
      })
    }
  }

  const surface: SessionEvent[] = []
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

  const messages: TranscriptMessage[] = []
  for (const event of surface) {
    const data = event.data || {}
    if (event.type === 'user/message') {
      const message = (data.message || data) as SessionMessage
      const source = message && message.source ? String(message.source.kind || '') : ''
      if (source && source !== 'user') continue
      const text = textBlocks(message)
      if (text) messages.push({ kind: 'user', seq: event.seq, text })
      continue
    }
    if (event.type === 'assistant/message') {
      const text = textBlocks(data.message)
      if (text)
        messages.push({
          kind: 'assistant',
          seq: event.seq,
          text,
          interrupted: data.interrupted === true,
        })
      continue
    }
    if (event.type === 'tool/result') {
      const message = (data.message || {}) as SessionMessage
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

const HISTORY_PAGE_MESSAGES = 200
const HISTORY_MAX_PAGES = 50

async function sessionEvents(sessionId: string): Promise<SessionEvent[]> {
  const controller = sessions()
  if (typeof controller.events === 'function') {
    const pages: SessionEvent[][] = []
    let beforeSeq: number | undefined
    for (let count = 0; count < HISTORY_MAX_PAGES; count += 1) {
      const page = await controller.events(
        {
          address: { kind: 'session', sessionId },
          maxMessages: HISTORY_PAGE_MESSAGES,
          beforeSeq,
        },
        signalFor(30000),
      )
      const batch = pageEvents(page)
      if (batch.length === 0) break
      pages.unshift(batch)
      const oldest = Number(batch[0].seq)
      if (page?.hasMore !== true || !Number.isFinite(oldest) || oldest <= 0) break
      beforeSeq = oldest
    }
    return pages.flat()
  }
  if (typeof controller.inspect !== 'function') {
    throw new Error('sessionController exposes neither events() nor inspect()')
  }
  const inspection = await controller.inspect(sessionId, signalFor(30000))
  return Array.isArray(inspection?.events) ? inspection.events : []
}

function pageEvents(page: SessionEventPage | null | undefined): SessionEvent[] {
  const records = Array.isArray(page?.records) ? page.records : []
  const events: SessionEvent[] = []
  for (const record of records) {
    const event = record && record.event
    if (event && typeof event.seq === 'number' && typeof event.type === 'string') {
      events.push(event)
    }
  }
  return events
}

function textBlocks(message: SessionMessage | null | undefined): string {
  const content = message && Array.isArray(message.content) ? message.content : []
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    if (block && block.type === 'image') parts.push('[图片]')
    if (block && block.type === 'file') parts.push('[文件]')
  }
  return parts.join('\n').trim()
}

const catalogCache: { at: number; value: ModelCatalog | null } = { at: 0, value: null }
const CATALOG_TTL = 5 * 60 * 1000

export async function modelCatalog(ctx: KindleContext): Promise<ModelCatalog> {
  const now = Date.now()
  if (catalogCache.value && now - catalogCache.at < CATALOG_TTL) return catalogCache.value
  const value = await sessions().modelCatalog()
  catalogCache.at = now
  catalogCache.value = value
  return value
}

export async function modelChoice(ctx: KindleContext, sessionId: string): Promise<ModelChoice> {
  const catalog = await modelCatalog(ctx)
  const fallback = catalog.default || { provider: '', model: '' }
  let selection: { provider: string; model: string; reasoningEffort?: string } = fallback
  try {
    const value = await sessions().projections({ sessionId }, signalFor(10000))
    const view = value && value.values ? value.values.modelSelection : null
    const chosen = view ? view.next || view.pending : null
    if (chosen) selection = chosen
  } catch (error) {}

  const group = (catalog.groups || []).find((entry) => entry.id === selection.provider)
  const model = group && (group.models || []).find((entry) => entry.id === selection.model)
  const reasoning = model && model.reasoning

  const info = await modelCapabilities(ctx, selection.provider, selection.model)
  const resolved = info && info.reasoning
  const catalogEfforts = reasoning && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
  const resolvedEfforts = resolved && Array.isArray(resolved.efforts) ? resolved.efforts : []
  const efforts = resolvedEfforts.length > 0 ? resolvedEfforts : catalogEfforts
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

export async function setReasoningEffort(
  ctx: KindleContext,
  sessionId: string,
  effort: string,
): Promise<ModelChoice> {
  const chosen = await modelChoice(ctx, sessionId)
  await sessions().selectModel({
    sessionId,
    provider: chosen.provider,
    model: chosen.model,
    reasoningEffort: effort,
  })
  return { ...chosen, current: effort }
}

const infoCache = new Map<string, { at: number; value: ModelInfo | null }>()

async function modelCapabilities(
  ctx: KindleContext,
  provider: string,
  model: string,
): Promise<ModelInfo | null> {
  const llm = host.llm
  if (!llm || typeof llm.resolveModelInfo !== 'function' || !provider || !model) return null
  const key = `${provider}/${model}`
  const hit = infoCache.get(key)
  if (hit && Date.now() - hit.at < CATALOG_TTL) return hit.value
  try {
    const info = await llm.resolveModelInfo(provider, model)
    if (infoCache.size > 20) infoCache.clear()
    infoCache.set(key, { at: Date.now(), value: info || null })
    return info || null
  } catch (error) {
    return null
  }
}

export function clearCatalogCache(): void {
  catalogCache.at = 0
  catalogCache.value = null
  infoCache.clear()
}
