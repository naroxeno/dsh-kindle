import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Generation } from './generation.js'

export interface KindleConfig {
  host: string
  port: number
  token: string
  cwd: string
  fontSize: number
  pageSize: number
  hotReload: boolean
}

export interface KindleLogger {
  info?: (message: string) => void
  error?: (message: string) => void
  warn?: (message: string) => void
}

export interface KindleHotStatus {
  generation: number
  reloads: number
  auto: boolean
  lastError: string
  version: string
}

export interface ReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface ModelReasoning {
  efforts?: ReasoningEffort[]
  defaultEffort?: string
}

export interface ModelRoute {
  provider: string
  model: string
}

export interface ModelSelection extends ModelRoute {
  reasoningEffort?: string
}

export interface ModelCatalogEntry {
  id: string
  name?: string
  reasoning?: ModelReasoning
}

export interface ModelCatalogGroup {
  id: string
  models?: ModelCatalogEntry[]
}

export interface ModelCatalog {
  default?: ModelRoute
  groups?: ModelCatalogGroup[]
}

export interface ModelChoice {
  provider: string
  model: string
  name: string
  efforts: ReasoningEffort[]
  current: string
}

export interface SessionListItem {
  sessionId: string
  origin?: string
  cwd?: string
  updatedAt?: number
  running?: boolean
  blank?: boolean
  projections?: { values?: { title?: unknown } }
}

export interface SessionListResult {
  items?: SessionListItem[]
}

export interface SessionSurfaceOp {
  op?: string
  startSeq?: number
  endSeq?: number
}

export interface SessionContentBlock {
  type?: string
  text?: string
}

export interface SessionMessage {
  source?: { kind?: string }
  content?: SessionContentBlock[]
  toolCallId?: unknown
  isError?: boolean
}

export interface SessionEventData {
  callId?: unknown
  name?: unknown
  arguments?: unknown
  message?: SessionMessage
  interrupted?: boolean
  error?: unknown
}

export interface SessionEvent {
  type: string
  seq: number
  surfaceOp?: SessionSurfaceOp
  data?: SessionEventData
}

export interface SessionAddress {
  kind: 'session'
  sessionId: string
}

export interface SessionEventRecord {
  type?: string
  event?: SessionEvent
}

export interface SessionEventPage {
  records?: SessionEventRecord[]
  hasMore?: boolean
  cursor?: number
}

export interface SessionInspection {
  events?: SessionEvent[]
}

export interface PromptRequest {
  requestId: string
  sessionId: string
  mode: 'queue'
  content: Array<{ type: 'text'; text: string }>
}

export interface SessionProjectionView {
  sessionId: string
  provider: string
  model: string
  reasoningEffort: string
}

export interface ModelSelectionView {
  lastUsed?: ModelSelection | null
  next?: ModelSelection | null
  pending?: ModelSelection | null
}

export interface SessionProjections {
  values?: { modelSelection?: ModelSelectionView | null }
}

export interface SystemPromptSectionInput {
  name: string
  order: number
  text: string
  interpolate: boolean
}

export interface SystemPromptService {
  section(input: SystemPromptSectionInput): (() => void) | undefined
}

export interface ResolvedAgent {
  ctx?: { systemPrompt?: SystemPromptService }
}

export interface AgentResolution {
  error?: { message?: unknown }
  agent?: ResolvedAgent
}

/**
 * `workspaceId` and `cwd` are mutually exclusive on the Host: passing a
 * workspace lets the Host resolve the directory and attach the new session to
 * that group. Passing only `cwd` creates the session outside every workspace,
 * which is what the GUI shows as「未分组」.
 */
export interface SessionCreateOptions {
  cwd?: string
  workspaceId?: string
  agentPreset?: string
}

export interface SessionControllerLike {
  list(
    query: Record<string, never>,
    signal?: AbortSignal,
  ): Promise<SessionListResult | null | undefined>
  create(options: SessionCreateOptions): Promise<{ sessionId?: string } | null | undefined>
  prompt(request: PromptRequest, signal?: AbortSignal): Promise<unknown>
  rename(input: { sessionId: string; title: string }): Promise<unknown>
  fork(input: { sessionId: string }): Promise<{ sessionId?: string } | null | undefined>
  events?(
    input: {
      address: SessionAddress
      throughSeq?: number
      beforeSeq?: number
      maxMessages?: number
    },
    signal?: AbortSignal,
  ): Promise<SessionEventPage | null | undefined>
  inspect?(sessionId: string, signal?: AbortSignal): Promise<SessionInspection | null | undefined>
  cancel(input: { sessionId: string }): Promise<unknown>
  modelCatalog(): Promise<ModelCatalog>
  projections(
    input: { sessionId: string },
    signal?: AbortSignal,
  ): Promise<SessionProjections | null | undefined>
  selectModel(input: SessionProjectionView): Promise<unknown>
  resolveAgent(sessionId: string): Promise<AgentResolution | null | undefined>
}

export interface WorkspaceControllerLike {
  archiveSession(input: { sessionId: string; stopActivity?: boolean }): Promise<unknown>
}

/**
 * The live workspace entity behind `registry.list()`. Only the parts the Kindle
 * UI needs are declared: `sessionIds` is a getter that re-filters by the record
 * path, and `attachSession` validates that the session's own cwd matches.
 */
export interface WorkspaceEntityLike {
  id: string
  path: string
  title?: string
  sessionIds?: Iterable<string>
  attachSession?(sessionId: string): Promise<unknown>
}

export interface WorkspaceRegistryLike {
  archivedSessionIds?: Iterable<string>
  get?(id: string): WorkspaceEntityLike | undefined
  list?(): WorkspaceEntityLike[]
  resolveByPath?(path: string): Promise<WorkspaceEntityLike | null | undefined>
  create?(path: string, title?: string): Promise<WorkspaceEntityLike>
}

export interface ClientMeta {
  version: string
  locale: string
  timezoneOffsetSeconds: number
}

export interface AccountState {
  status?: string
  links?: { usageUrl?: unknown; topUpUrl?: unknown }
}

export interface AccountBalance {
  status?: string
  value?: unknown
  bonusWallets?: unknown
}

export interface AccountControllerLike {
  getState(): Promise<AccountState | null | undefined>
  getBalance(meta: ClientMeta): Promise<AccountBalance | null | undefined>
}

export interface ModelInfo {
  name?: string
  reasoning?: ModelReasoning
}

export interface LlmLike {
  resolveModelInfo(provider: string, model: string): Promise<ModelInfo | null | undefined>
}

export interface KindleServices {
  sessionController: SessionControllerLike
  workspaceController: WorkspaceControllerLike | null
  workspaceRegistry: WorkspaceRegistryLike | null
  llm: LlmLike | null
  accountController: AccountControllerLike | null
}

export interface KindleContext {
  sessionController: SessionControllerLike
}

export interface KindleHost {
  ctx: KindleContext
  config: KindleConfig
  auth: { token: string; hash: string | null }
  services: KindleServices
  logger: KindleLogger
  hot?: () => KindleHotStatus
}

export interface KindleApp {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
  version: string
  modules: Generation
  setHost(next: KindleServices): void
  dispose(): void
  loginPage(next: string, options?: { error?: boolean }): string
  errorPage(status: number, message: string): string
}
