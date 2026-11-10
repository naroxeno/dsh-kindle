import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Generation } from './generation.js'
import type {
  KindleApp,
  KindleContext,
  KindleHost,
  KindleLogger,
  ModelChoice,
  UserQuestion,
  UserQuestionAnswerItem,
  UserQuestionRequest,
} from './host.js'
import type { Transcript, TranscriptMessage, WorkspaceEntry } from './sessions.js'
import { renderFilesPin } from './ui.js'
import type { AskView, FileRow, ListExtras, SettingsNotice, SettingsView } from './ui.js'

const STAMP = new URL(import.meta.url).search
const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version

const LIST_MAX = 60
const FILE_PAGE_SIZE = 60
const MARKDOWN_MAX_BYTES = 1024 * 1024
/** How recently a Kindle page must have polled before it may take a question. */
const ASK_CLAIM_MS = 45_000

interface PendingAsk {
  token: string
  sessionId: string
  window: number
  questions: UserQuestion[]
  resolve: (answer: { answers: UserQuestionAnswerItem[] }) => void
  reject: (error: unknown) => void
}

interface AskSeen {
  at: number
  window: number
}

interface AskStore {
  pending: Map<string, PendingAsk>
  seen: Map<string, AskSeen>
}

/** Shared through hot generations so an open question survives a code swap. */
const ASK_STORE_KEY = Symbol.for('dsh-kindle.ask')

function askStore(): AskStore {
  const shared = globalThis as unknown as { [key: symbol]: AskStore | undefined }
  let store = shared[ASK_STORE_KEY]
  if (!store) {
    store = { pending: new Map(), seen: new Map() }
    shared[ASK_STORE_KEY] = store
  }
  return store
}

function askNoticeOf(flag: string | null): string | undefined {
  if (flag === 'ok') return '已提交回答。'
  if (flag === 'gone') return '这个问题已经失效了，AI 已经继续。'
  return undefined
}

/** A second, separate secret for the file browser: six digits, one hour. */
const FILES_PIN_FILE = '.kindle-files-pin'
const FILES_KEY_FILE = '.kindle-files-key'
const FILES_COOKIE = 'kdf'
const FILES_PIN_TTL = 3600
const FILE_ROUTES = new Set(['/files', '/f', '/t', '/i', '/img'])
const TEXT_EXTS = new Set([
  '.txt',
  '.text',
  '.log',
  '.json',
  '.csv',
  '.tsv',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.conf',
  '.sh',
  '.py',
  '.js',
  '.ts',
  '.mjs',
  '.cjs',
  '.rs',
  '.go',
  '.c',
  '.h',
  '.css',
  '.html',
  '.xml',
  '.sql',
])
const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.tar',
  '.bz2',
  '.xz',
  '.7z',
  '.mp3',
  '.mp4',
  '.m4a',
  '.wav',
  '.ogg',
  '.webm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.jar',
  '.class',
  '.exe',
  '.so',
  '.dylib',
  '.o',
  '.a',
  '.db',
  '.sqlite',
  '.parquet',
  '.ico',
])

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function createApp(host: KindleHost): Promise<KindleApp> {
  const { ctx, config, services, logger } = host
  const generation = (await import('./generation.js' + STAMP)) as {
    load(): Promise<Generation>
  }
  const { sessions: sessionsApi, math, ui, prompt, account } = await generation.load()
  sessionsApi.setHost(services)

  // The Kindle UI keeps its own preferences; the deployment config only seeds
  // them. `config.cwd` stays the anchor because it never changes without a
  // dsh restart, so the file survives hot generations.
  const settingsFile = join(config.cwd, '.kindle-settings.json')
  const settings = await loadSettings(settingsFile)
  // The shell hashes the token only at mount, so a rotated .kindle-token would
  // wait for a Host restart. Sync it here instead: this runs before the request
  // is authorized, and hot generations pick the new hash up immediately.
  await syncAuthToken(host)
  const filesAccess = await createFilesAccess(config, logger)
  // The indent is a Kindle UI preference; hang it on the config every renderer
  // already receives so no page can disagree with another.
  config.indent = Boolean(settings.indent)
  // Articles read better indented on an e-ink screen, so that one is on unless
  // the settings file says otherwise.
  config.indentArt = settings.indentArt !== false
  const activeCwd = (): string => settings.workspace || config.cwd
  const asks = askStore()
  const ownedAsks = new Set<string>()

  function pendingAskView(sessionId: string): AskView | null {
    const entry = asks.pending.get(sessionId)
    return entry
      ? { token: entry.token, sessionId, window: entry.window, questions: entry.questions }
      : null
  }

  function claimQuestion(request: UserQuestionRequest, next: () => unknown): unknown {
    const agentId = typeof request.agent?.id === 'string' ? request.agent.id : ''
    const seen = asks.seen.get(agentId)
    if (!agentId || !Array.isArray(request.questions) || request.questions.length === 0) {
      return next()
    }
    if (!seen || Date.now() - seen.at > ASK_CLAIM_MS || asks.pending.has(agentId)) return next()
    return new Promise<{ answers: UserQuestionAnswerItem[] }>((resolve, reject) => {
      const entry: PendingAsk = {
        token: randomBytes(9).toString('hex'),
        sessionId: agentId,
        window: seen.window || config.pageSize,
        questions: request.questions,
        resolve,
        reject,
      }
      asks.pending.set(agentId, entry)
      ownedAsks.add(agentId)
      const cancel = () => {
        if (asks.pending.get(agentId) !== entry) return
        asks.pending.delete(agentId)
        ownedAsks.delete(agentId)
        reject(new Error('在 Kindle 上关掉了这个问题'))
      }
      const signal = request.signal
      if (!signal) return
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
    })
  }

  const offAsk = ctx.on?.(
    'user-questions/request',
    (request: unknown, next: () => unknown) => claimQuestion(request as UserQuestionRequest, next),
    { prepend: true },
  )

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await route(req, res)
    } catch (error) {
      if (error instanceof HttpError) {
        sendHtml(res, error.status, renderErrorPage(error.status, error.message))
        return
      }
      const detail = error as { stack?: unknown } | null
      logger.error?.(String(detail && detail.stack ? detail.stack : error))
      if (res.headersSent) {
        res.destroy()
        return
      }
      sendHtml(res, 500, renderErrorPage(500, errorText(error)))
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://kindle.invalid')
    const path = url.pathname
    const method = (req.method || 'GET').toUpperCase()

    if (method === 'POST' && path === '/files/unlock') {
      await filesAccess.unlock(req, res)
      return
    }
    if (FILE_ROUTES.has(path) && !filesAccess.allowed(req)) {
      const notice = filesAccess.notice(req)
      sendHtml(res, 200, renderFilesPin(config, { next: path + url.search, ...notice }))
      return
    }

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      redirect(res, '/s')
      return
    }

    if (method === 'GET' && path === '/login') {
      redirect(res, '/s')
      return
    }

    if (method === 'GET' && path === '/s') {
      const query = searchQuery(url.searchParams.get('q'))
      const all = await sessionsApi.listSessions(ctx, activeCwd())
      const matched = query ? filterSessions(all, query) : all
      const balance = await account.readAccount(services.accountController, { timeoutMs: 1500 })
      const extras: ListExtras = {
        balance: account.balanceLine(balance),
        total: matched.length,
        query,
        workspace: await workspaceLabel(),
      }
      sendHtml(res, 200, ui.renderList(config, matched.slice(0, LIST_MAX), '', extras))
      return
    }

    // The search box has to be a POST: the Kindle renderer only submits forms
    // that way (a GET form is re-encoded and breaks long queries), so the query
    // arrives here and the page itself reads it back from the address bar.
    if (method === 'POST' && path === '/s') {
      const body = await readBody(req)
      const query = searchQuery(body.get('q'))
      redirect(res, query ? '/s?q=' + encodeURIComponent(query) : '/s')
      return
    }

    if (method === 'GET' && path === '/settings') {
      if (url.searchParams.get('hidden') === '1' && !filesAccess.allowed(req)) {
        const query = searchQuery(url.searchParams.get('q'))
        const next = '/settings?hidden=1' + (query ? '&q=' + encodeURIComponent(query) : '')
        sendHtml(res, 200, ui.renderFilesPin(config, { next, scope: 'settings' }))
        return
      }
      sendHtml(
        res,
        200,
        ui.renderSettings(
          config,
          await settingsView(
            noticeFor(url),
            searchQuery(url.searchParams.get('q')),
            url.searchParams.get('hidden') === '1',
          ),
        ),
      )
      return
    }

    if (method === 'POST' && path === '/settings') {
      const body = await readBody(req)
      if (String(body.get('action') || '') === 'filter') {
        const wanted = searchQuery(body.get('q'))
        const params = new URLSearchParams()
        if (String(body.get('view') || '') === 'hidden') params.set('hidden', '1')
        if (wanted) params.set('q', wanted)
        const tail = params.toString()
        redirect(res, '/settings' + (tail ? '?' + tail : ''))
        return
      }
      if (String(body.get('action') || '') === 'indent') {
        const on = String(body.get('value') || '') === 'on'
        const which = String(body.get('target') || '') === 'file' ? 'file' : 'chat'
        if (which === 'file') {
          settings.indentArt = on
          config.indentArt = on
        } else {
          settings.indent = on
          config.indent = on
        }
        try {
          await saveSettings(settingsFile, settings)
        } catch (error) {
          sendHtml(
            res,
            200,
            ui.renderSettings(
              config,
              await settingsView({ text: '存不了设置：' + errorText(error), error: true }),
            ),
          )
          return
        }
        redirect(res, '/settings?ok=indent&t=' + which)
        return
      }
      if (String(body.get('action') || '') === 'adopt') {
        try {
          const entry = await sessionsApi.ensureWorkspace(activeCwd())
          if (!entry) throw new Error('这个 Host 没有挂载 workspace 服务')
          const group = await sessionsApi.listSessions(ctx, entry.path)
          const adopted = await sessionsApi.adoptWorkspaceSessions(
            entry.id,
            group.map((item) => item.sessionId),
          )
          redirect(res, '/settings?ok=adopted&n=' + adopted)
        } catch (error) {
          sendHtml(
            res,
            200,
            ui.renderSettings(
              config,
              await settingsView({
                text: '归组失败：' + errorText(error),
                error: true,
              }),
            ),
          )
        }
        return
      }

      const op = String(body.get('action') || '')
      if (op === 'hide' || op === 'unhide') {
        const keep = String(body.get('view') || '') === 'hidden'
        const wanted = expandHome(String(body.get('path') || '').trim())
        if (op === 'hide' && wanted === activeCwd()) {
          sendHtml(
            res,
            200,
            ui.renderSettings(
              config,
              await settingsView({
                text: '当前工作区不能隐藏，先换成别的工作区。',
                error: true,
              }),
            ),
          )
          return
        }
        const hidden = new Set(settings.hidden || [])
        if (wanted) {
          if (op === 'hide') hidden.add(wanted)
          else hidden.delete(wanted)
        }
        const nextHidden = [...hidden]
        settings.hidden = nextHidden
        try {
          await saveSettings(settingsFile, settings)
        } catch (error) {
          sendHtml(
            res,
            200,
            ui.renderSettings(
              config,
              await settingsView({ text: '存不了设置：' + errorText(error), error: true }),
            ),
          )
          return
        }
        const stay = keep && nextHidden.length
        redirect(
          res,
          (stay ? '/settings?hidden=1&ok=' : '/settings?ok=') + (op === 'hide' ? 'hide' : 'unhide'),
        )
        return
      }

      const raw = String(body.get('path') || '').trim()
      const wanted = expandHome(raw)
      if (!wanted) {
        sendHtml(
          res,
          200,
          ui.renderSettings(
            config,
            await settingsView({ text: '请填一个目录路径。', error: true }),
          ),
        )
        return
      }
      if (!isAbsolute(wanted)) {
        sendHtml(
          res,
          200,
          ui.renderSettings(
            config,
            await settingsView({
              text: '请填绝对路径，例如 /home/naroxeno/kindle-ws。',
              error: true,
            }),
          ),
        )
        return
      }
      let entry: WorkspaceEntry | null = null
      try {
        entry = await sessionsApi.ensureWorkspace(wanted)
      } catch (error) {
        sendHtml(
          res,
          200,
          ui.renderSettings(
            config,
            await settingsView({
              text: '这个目录用不了：' + errorText(error),
              error: true,
            }),
          ),
        )
        return
      }
      settings.workspace = entry ? entry.path : wanted
      try {
        await saveSettings(settingsFile, settings)
      } catch (error) {
        sendHtml(
          res,
          200,
          ui.renderSettings(
            config,
            await settingsView({ text: '存不了设置：' + errorText(error), error: true }),
          ),
        )
        return
      }
      // Saving is also the moment to fold the directory's older sessions into
      // the group, otherwise the list keeps showing the same「未分组」items.
      let adopted = 0
      if (entry) {
        try {
          const group = await sessionsApi.listSessions(ctx, entry.path)
          adopted = await sessionsApi.adoptWorkspaceSessions(
            entry.id,
            group.map((item) => item.sessionId),
          )
        } catch (error) {
          logger.warn?.('kindle-ui: could not group old sessions: ' + errorText(error))
        }
      }
      redirect(res, '/settings?ok=saved' + (adopted > 0 ? '&n=' + adopted : ''))
      return
    }

    if (method === 'GET' && path === '/me') {
      const balance = await account.readAccount(services.accountController, { timeoutMs: 6000 })
      sendHtml(res, 200, ui.renderAccount(config, { account: balance }))
      return
    }

    if (method === 'GET' && path === '/debug') {
      const status = prompt.promptStatus()
      const text = await prompt.kindlePrompt()
      const hot = typeof host.hot === 'function' ? host.hot() : null
      const generation = Number(hot && hot.generation) || 0
      const reloads = Number(hot && hot.reloads) || 0
      const lines = [
        'kindle-ui ' + VERSION,
        'hot: generation ' +
          generation +
          ' (' +
          reloads +
          ' reload' +
          (reloads === 1 ? '' : 's') +
          ', auto ' +
          (hot && hot.auto ? 'on' : 'off') +
          ')',
      ]
      if (hot && hot.lastError) lines.push('hot error: ' + hot.lastError)
      lines.push(
        JSON.stringify(status),
        'prompt bytes: ' + Buffer.byteLength(text),
        'delete (workspace services): ' + (services.workspaceController ? 'ready' : 'missing'),
        'account (balance): ' + (services.accountController ? 'ready' : 'missing'),
        'model catalog: ' + (await catalogLine(ctx)),
        'agent presets: ' + (await presetLine(ctx)),
        'workspace: ' + activeCwd() + (settings.workspace ? ' (/settings)' : ' (config cwd)'),
        'workspaces: ' + ((await sessionsApi.listWorkspaces()) ? 'registered' : 'missing'),
        'settings file: ' + settingsFile,
        'price: ' + account.priceWindow().label + '（' + account.priceWindow().detail + '）',
      )
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(lines.join('\n') + '\n')
      return
    }

    if (method === 'GET' && path === '/img') {
      serveLocalImage([activeCwd(), config.cwd, process.cwd()], req, res, url)
      return
    }

    if (method === 'GET' && path === '/files') {
      const sessionId = String(url.searchParams.get('s') || '')
      const roots = readRoots()
      let dir = roots[0] || process.cwd()
      const rawDir = String(url.searchParams.get('p') || '')
      if (rawDir) {
        const wanted = expandHome(rawDir)
        const abs = isAbsolute(wanted) ? wanted : resolve(dir, wanted)
        if (!roots.some((root) => isInside(abs, root))) {
          throw new HttpError(403, '这个目录不在可读目录里。')
        }
        let info
        try {
          info = statSync(abs)
        } catch (error) {
          throw new HttpError(404, '目录不存在。')
        }
        if (!info.isDirectory()) throw new HttpError(404, '目录不存在。')
        dir = abs
      }
      const base =
        roots.filter((root) => isInside(dir, root)).sort((a, b) => b.length - a.length)[0] || dir
      const rel = relative(base, dir)
      const crumbs = [
        {
          name: base === roots[0] ? await workspaceLabel() : basename(base),
          path: base,
        },
      ]
      if (rel) {
        let walk = base
        for (const part of rel.split(sep)) {
          walk = join(walk, part)
          crumbs.push({ name: part, path: walk })
        }
      }
      const rows = await listDirEntries(dir)
      sendHtml(
        res,
        200,
        ui.renderFiles(config, {
          ...(sessionId ? { sessionId } : {}),
          workspace: await workspaceLabel(),
          dir,
          label: rel || '根目录',
          ...(dir !== base ? { parent: dirname(dir) } : {}),
          crumbs,
          entries: rows.slice(0, FILE_PAGE_SIZE),
          truncated: rows.length > FILE_PAGE_SIZE,
        }),
      )
      return
    }

    if (method === 'GET' && path === '/f') {
      const file = resolveReadableFile(String(url.searchParams.get('p') || ''), readRoots())
      let info
      try {
        info = statSync(file)
      } catch (error) {
        throw new HttpError(404, '文件不存在。')
      }
      if (!info.isFile()) throw new HttpError(404, '文件不存在。')
      if (info.size > MARKDOWN_MAX_BYTES) throw new HttpError(413, '文件太大（上限 1 MB）。')
      const from = safeFrom(url.searchParams.get('from'))
      const rawAt = url.searchParams.get('at')
      const at = rawAt === null ? NaN : Number(rawAt)
      sendHtml(
        res,
        200,
        ui.renderFile(config, {
          path: file,
          name: basename(file),
          dir: dirname(file),
          size: info.size,
          updatedAt: info.mtimeMs,
          source: await readFile(file, 'utf8'),
          ...(from ? { from } : {}),
          ...(Number.isInteger(at) && at >= 0 ? { at } : {}),
        }),
      )
      return
    }

    if (method === 'GET' && path === '/t') {
      const file = await resolveReadableText(String(url.searchParams.get('p') || ''), readRoots())
      let info
      try {
        info = statSync(file)
      } catch (error) {
        throw new HttpError(404, '文件不存在。')
      }
      if (!info.isFile()) throw new HttpError(404, '文件不存在。')
      if (info.size > MARKDOWN_MAX_BYTES) throw new HttpError(413, '文件太大（上限 1 MB）。')
      const from = safeFrom(url.searchParams.get('from'))
      sendHtml(
        res,
        200,
        ui.renderTextView(config, {
          path: file,
          name: basename(file),
          dir: dirname(file),
          size: info.size,
          updatedAt: info.mtimeMs,
          source: await readFile(file, 'utf8'),
          ...(from ? { from } : {}),
        }),
      )
      return
    }

    if (method === 'GET' && path === '/i') {
      const raw = String(url.searchParams.get('p') || '')
      if (!raw) throw new HttpError(404, '没有指定图片。')
      const wanted = expandHome(raw)
      const file = isAbsolute(wanted) ? wanted : resolve(readRoots()[0] || process.cwd(), wanted)
      if (!readRoots().some((root) => isInside(file, root))) {
        throw new HttpError(403, '这个图片不在可读目录里。')
      }
      if (!IMAGE_MIME[extname(file).toLowerCase()]) throw new HttpError(404, '不是图片。')
      let info
      try {
        info = statSync(file)
      } catch (error) {
        throw new HttpError(404, '图片不存在。')
      }
      if (!info.isFile()) throw new HttpError(404, '图片不存在。')
      if (info.size > IMAGE_MAX_BYTES) throw new HttpError(413, '图片太大。')
      const from = safeFrom(url.searchParams.get('from'))
      sendHtml(
        res,
        200,
        ui.renderImage(config, {
          path: file,
          name: basename(file),
          dir: dirname(file),
          size: info.size,
          updatedAt: info.mtimeMs,
          ...(from ? { from } : {}),
        }),
      )
      return
    }

    if (method === 'GET' && path === '/new') {
      const roster = await sessionsApi.agentPresetRoster(ctx)
      sendHtml(
        res,
        200,
        ui.renderNewSession(config, {
          options: roster ? roster.presets : [],
          defaultId: roster ? roster.defaultId : '',
        }),
      )
      return
    }

    if (method === 'POST' && path === '/new') {
      const body = await readBody(req)
      const preset = String(body.get('preset') || '').trim()
      const target = await sessionTarget()
      const sessionId = await sessionsApi.createSession(ctx, {
        ...(target.workspaceId ? { workspaceId: target.workspaceId } : { cwd: target.cwd }),
        ...(preset ? { agentPreset: preset } : {}),
      })
      redirect(res, '/c/' + encodeURIComponent(sessionId))
      return
    }

    const parts = path.split('/').filter(Boolean)
    if (parts[0] !== 'c' || !parts[1]) {
      throw new HttpError(404, '没有这个页面。')
    }
    const sessionId = decodeURIComponent(parts[1])
    const action = parts[2] || ''

    await requireOwnedSession(sessionsApi, ctx, activeCwd(), sessionId)

    await prompt.ensureKindlePrompt(ctx.sessionController, sessionId)

    if (method === 'GET' && action === '') {
      const window = clampInt(
        Number(url.searchParams.get('n')) || config.pageSize,
        1,
        400,
        config.pageSize,
      )
      asks.seen.set(sessionId, { at: Date.now(), window })
      let transcript: Transcript
      try {
        transcript = await sessionsApi.readTranscript(ctx, sessionId, activeCwd())
      } catch (error) {
        logger.warn?.('kindle transcript read failed for ' + sessionId + ': ' + errorText(error))
        transcript = {
          title: '',
          messages: [],
          rewriteFloor: 0,
          running: true,
          updatedAt: Date.now(),
        }
      }
      const visible = windowMessages(transcript.messages, window)
      sendHtml(
        res,
        200,
        ui.renderSession(config, {
          sessionId,
          title: transcript.title,
          cwd: activeCwd(),
          model: await modelInfo(ctx, sessionsApi, sessionId),
          messages: visible,
          running: transcript.running,
          updatedAt: transcript.updatedAt,
          version: transcript.updatedAt + ':' + (transcript.running ? 1 : 0),
          fresh: url.searchParams.get('fresh') === '1',
          hasOlder: transcript.messages.length > visible.length,
          hasTools: visible.some((message) => message.kind === 'tool'),
          cursor: visible.length ? visible[visible.length - 1].seq : 0,
          window,
          ask: pendingAskView(sessionId),
          askNotice: askNoticeOf(url.searchParams.get('ask')),
        }),
      )
      return
    }

    if (method === 'GET' && action === 'tools') {
      let transcript: Transcript
      try {
        transcript = await sessionsApi.readTranscript(ctx, sessionId, activeCwd())
      } catch (error) {
        logger.warn?.('kindle transcript read failed for ' + sessionId + ': ' + errorText(error))
        transcript = {
          title: '',
          messages: [],
          rewriteFloor: 0,
          running: true,
          updatedAt: Date.now(),
        }
      }
      const calls = transcript.messages.filter((message) => message.kind === 'tool')
      const TOOL_PAGE = 120
      sendHtml(
        res,
        200,
        ui.renderTools(config, {
          sessionId,
          title: transcript.title,
          tools: calls.slice(-TOOL_PAGE).reverse(),
          total: calls.length,
          updatedAt: transcript.updatedAt,
        }),
      )
      return
    }

    if (method === 'GET' && action === 'tail') {
      const windowSize = clampInt(
        Number(url.searchParams.get('n')) || config.pageSize,
        1,
        400,
        config.pageSize,
      )
      asks.seen.set(sessionId, { at: Date.now(), window: windowSize })
      const since = Math.max(0, Math.floor(Number(url.searchParams.get('since')) || 0))
      let transcript
      try {
        transcript = await sessionsApi.readTranscript(ctx, sessionId, activeCwd())
      } catch (error) {
        logger.warn?.('kindle transcript read failed for ' + sessionId + ': ' + errorText(error))
        transcript = {
          messages: [],
          rewriteFloor: 0,
          running: true,
          updatedAt: Date.now(),
          title: '',
        }
      }
      const visible = windowMessages(transcript.messages, windowSize)
      const cursor = visible.length ? visible[visible.length - 1].seq : 0
      const floor = Number(transcript.rewriteFloor) || 0
      const before = since > 0 ? visible.findIndex((message) => message.seq === since) : -1
      const appendable = since > 0 && before !== -1 && (floor === 0 || floor > since)
      const pending = appendable ? visible.slice(before + 1) : []
      const toolsHref = '/c/' + encodeURIComponent(sessionId) + '/tools'
      const ask = pendingAskView(sessionId)
      const payload = {
        mode: appendable ? 'append' : 'replace',
        html: appendable
          ? pending.length
            ? ui.renderMessages(config, pending, toolsHref, {
                cwd: activeCwd(),
                from: '/c/' + encodeURIComponent(sessionId),
              })
            : ''
          : ui.renderMessages(config, visible, toolsHref, {
              cwd: activeCwd(),
              from: '/c/' + encodeURIComponent(sessionId),
            }),
        cursor,
        running: transcript.running ? 1 : 0,
        version: transcript.updatedAt + ':' + (transcript.running ? 1 : 0),
        ask: ask ? { id: ask.token, html: ui.renderAsk(config, ask) } : null,
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(payload))
      return
    }

    if (method === 'GET' && action === 'state') {
      const current = await sessionsApi.sessionState(ctx, sessionId, activeCwd())
      if (!current) throw new HttpError(404, '会话不存在。')
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(current.updatedAt + ':' + (current.running ? 1 : 0))
      return
    }

    if (method === 'POST' && action === 'send') {
      const body = await readBody(req)
      const draft = String(body.get('msg') || '')
      if (draft.trim()) {
        await sessionsApi.sendPrompt(ctx, sessionId, math.convertPromptMath(draft))
      }
      redirect(res, '/c/' + encodeURIComponent(sessionId) + '?fresh=1')
      return
    }

    if (method === 'POST' && action === 'answer') {
      const body = await readBody(req)
      const window = clampInt(Number(body.get('n')) || config.pageSize, 1, 400, config.pageSize)
      const entry = asks.pending.get(sessionId)
      if (!entry || String(body.get('t') || '') !== entry.token) {
        redirect(res, '/c/' + encodeURIComponent(sessionId) + '?ask=gone&n=' + window)
        return
      }
      asks.pending.delete(sessionId)
      ownedAsks.delete(sessionId)
      const skip = body.get('skip') === '1'
      const answers: UserQuestionAnswerItem[] = entry.questions.map((question, index) => {
        if (skip) return { id: question.id, selected: [] }
        const options = question.options || []
        const picked: string[] = []
        for (const raw of body.getAll('p' + index)) {
          const at = Number(raw)
          if (!Number.isInteger(at) || at < 0 || at >= options.length) continue
          const label = options[at].label
          if (!picked.includes(label)) picked.push(label)
        }
        const custom = String(body.get('c' + index) || '')
          .trim()
          .slice(0, 4000)
        if (!question.multiSelect) {
          return custom
            ? { id: question.id, selected: [], custom }
            : { id: question.id, selected: picked.length ? [picked[0]] : [] }
        }
        return custom
          ? { id: question.id, selected: picked, custom }
          : { id: question.id, selected: picked }
      })
      entry.resolve({ answers })
      redirect(res, '/c/' + encodeURIComponent(sessionId) + '?ask=ok&fresh=1&n=' + window)
      return
    }

    if (method === 'POST' && action === 'preview') {
      const body = await readBody(req)
      const draft = String(body.get('msg') || '')
      sendHtml(res, 200, ui.renderPreview(config, { sessionId, draft }))
      return
    }

    if (method === 'GET' && action === 'rename') {
      const current = await sessionsApi.sessionState(ctx, sessionId, activeCwd())
      sendHtml(
        res,
        200,
        ui.renderRename(config, { sessionId, title: current ? current.title : '' }),
      )
      return
    }

    if (method === 'POST' && action === 'rename') {
      const body = await readBody(req)
      const title = String(body.get('title') || '')
        .trim()
        .slice(0, 100)
      if (!title) throw new HttpError(400, '标题不能为空。')
      await sessionsApi.renameSession(ctx, sessionId, title)
      redirect(res, '/c/' + encodeURIComponent(sessionId))
      return
    }

    if (method === 'POST' && action === 'effort') {
      const body = await readBody(req)
      const effort = String(body.get('effort') || '')
      const model = await modelInfo(ctx, sessionsApi, sessionId)
      const known = model.efforts.some((entry) => entry.id === effort)
      if (!known) throw new HttpError(400, '这个模型不支持该思考强度。')
      await sessionsApi.setReasoningEffort(ctx, sessionId, effort)
      redirect(res, '/c/' + encodeURIComponent(sessionId) + '?fresh=1')
      return
    }

    if (method === 'POST' && action === 'fork') {
      const forked = await sessionsApi.forkSession(ctx, sessionId)
      try {
        await sessionsApi.labelFork(ctx, sessionId, forked, activeCwd())
      } catch (error) {
        logger.error?.('kindle-ui: could not title fork ' + forked + ': ' + errorText(error))
      }
      redirect(res, '/c/' + encodeURIComponent(forked))
      return
    }

    if (method === 'GET' && action === 'delete') {
      const current = await sessionsApi.sessionState(ctx, sessionId, activeCwd())
      sendHtml(
        res,
        200,
        ui.renderDelete(config, {
          sessionId,
          title: current ? current.title : '',
          cwd: activeCwd(),
        }),
      )
      return
    }

    if (method === 'POST' && action === 'delete') {
      try {
        await sessionsApi.archiveSession(ctx, sessionId)
      } catch (error) {
        throw new HttpError(409, '删不掉：' + errorText(error))
      }
      redirect(res, '/s')
      return
    }

    if (method === 'POST' && action === 'stop') {
      await sessionsApi.cancelSession(ctx, sessionId)
      redirect(res, '/c/' + encodeURIComponent(sessionId))
      return
    }

    throw new HttpError(404, '没有这个页面。')
  }

  return {
    handle,
    version: VERSION,
    modules: { sessions: sessionsApi, math, ui, prompt, account },
    setHost(next) {
      sessionsApi.setHost(next)
    },
    dispose() {
      if (typeof offAsk === 'function') offAsk()
      for (const sessionId of ownedAsks) {
        const entry = asks.pending.get(sessionId)
        if (!entry) continue
        asks.pending.delete(sessionId)
        entry.reject(new Error('Kindle 插件已卸载'))
      }
      ownedAsks.clear()
    },
    loginPage(next, options) {
      return ui.renderLogin(config, next, options)
    },
    errorPage(status, message) {
      return renderErrorPage(status, message)
    },
  }

  function modelInfo(
    controller: KindleContext,
    api: Generation['sessions'],
    sessionId: string,
  ): Promise<ModelChoice> {
    return api.modelChoice(controller, sessionId).catch(() => ({
      provider: '',
      model: '',
      name: '',
      efforts: [],
      current: '',
    }))
  }

  async function catalogLine(controller: KindleContext): Promise<string> {
    try {
      const model = await sessionsApi.modelChoice(controller, '')
      const names = model.efforts.map((entry) => entry.id).join(',')
      return model.provider + '/' + model.model + ' (' + (names || 'no reasoning') + ')'
    } catch (error) {
      return 'unavailable: ' + errorText(error)
    }
  }

  async function presetLine(controller: KindleContext): Promise<string> {
    try {
      const roster = await sessionsApi.agentPresetRoster(controller)
      if (!roster) return 'none'
      if (!roster.presets.length) return 'empty'
      return (
        roster.presets.map((preset) => preset.id + (preset.broken ? '(broken)' : '')).join(', ') +
        ' | default ' +
        (roster.defaultId || '?')
      )
    } catch (error) {
      return 'unavailable: ' + errorText(error)
    }
  }

  async function requireOwnedSession(
    api: Generation['sessions'],
    controller: KindleContext,
    cwd: string,
    sessionId: string,
  ): Promise<void> {
    const sessions = await api.listSessions(controller, cwd)
    if (!sessions.some((entry) => entry.sessionId === sessionId)) {
      throw new HttpError(404, '这个会话不在 Kindle 工作区里。')
    }
  }

  /**
   * Where a new session should land. When the Host groups at all, the cwd is
   * turned into a workspace first: `session.create({workspaceId})` makes the
   * Host attach the session, which is the only thing that keeps it out of the
   * GUI's「未分组」bucket.
   */
  async function sessionTarget(): Promise<{ workspaceId?: string; cwd: string }> {
    const path = activeCwd()
    let entry: WorkspaceEntry | null = null
    try {
      entry = await sessionsApi.ensureWorkspace(path)
    } catch (error) {
      throw new HttpError(
        400,
        '默认工作区用不了：' + errorText(error) + '。请在「设置」里换一个目录。',
      )
    }
    if (entry) return { workspaceId: entry.id, cwd: entry.path }
    return { cwd: path }
  }

  async function workspaceLabel(): Promise<string> {
    const path = activeCwd()
    try {
      const list = await sessionsApi.listWorkspaces()
      const entry = list ? list.find((item) => item.path === path) : undefined
      if (entry && entry.title) return entry.title
    } catch (error) {}
    return basename(path) || path
  }

  async function settingsView(
    notice?: SettingsNotice,
    query?: string,
    reveal = false,
  ): Promise<SettingsView> {
    const path = activeCwd()
    const list = (await sessionsApi.listWorkspaces()) || []
    const current = list.find((entry) => entry.path === path)
    const sessions = await sessionsApi.listSessions(ctx, path)
    const member = new Set(current ? current.sessionIds : [])
    const needle = (query || '').toLowerCase()
    const hidden = new Set(settings.hidden || [])
    const hiddenCount = list.filter((entry) => hidden.has(entry.path)).length
    const shown = (
      needle
        ? list.filter(
            (entry) =>
              (entry.title || '').toLowerCase().includes(needle) ||
              entry.path.toLowerCase().includes(needle),
          )
        : list
    ).filter((entry) => reveal || !hidden.has(entry.path))
    return {
      path,
      title: current && current.title ? current.title : basename(path) || path,
      registered: Boolean(current),
      registryReady: Boolean(services.workspaceRegistry && services.workspaceRegistry.list),
      query,
      reveal,
      hiddenCount,
      choices: shown.map((entry) => ({
        id: entry.id,
        path: entry.path,
        title: entry.title || basename(entry.path) || entry.path,
        current: entry.path === path,
        hidden: hidden.has(entry.path) || undefined,
      })),
      ungrouped: sessions.filter((item) => !member.has(item.sessionId)).length,
      indent: Boolean(settings.indent),
      indentArt: settings.indentArt !== false,
      notice,
      settingsFile,
    }
  }

  function noticeFor(url: URL): SettingsNotice | undefined {
    const ok = url.searchParams.get('ok')
    if (ok === 'saved') {
      const count = Math.max(0, Number(url.searchParams.get('n')) || 0)
      return {
        text: count ? '默认工作区已保存，' + count + ' 个旧会话也归了组。' : '默认工作区已保存。',
      }
    }
    if (ok === 'indent') {
      const article = url.searchParams.get('t') === 'file'
      const on = article ? config.indentArt !== false : Boolean(config.indent)
      const what = article ? '文章与文件' : '会话正文'
      return { text: what + (on ? '改为段首缩进 2em。' : '改回不缩进。') }
    }
    if (ok === 'adopted') {
      const count = Math.max(0, Number(url.searchParams.get('n')) || 0)
      return {
        text: count
          ? '已把 ' + count + ' 个会话归入当前工作区。'
          : '当前工作区里没有需要归组的会话。',
      }
    }
    if (ok === 'hide' || ok === 'unhide') {
      return {
        text: ok === 'hide' ? '已隐藏这个工作区，输密码才能再看到。' : '已取消隐藏。',
      }
    }
    return undefined
  }

  function readBody(req: IncomingMessage, limit = 512 * 1024): Promise<URLSearchParams> {
    return new Promise<URLSearchParams>((resolveBody, rejectBody) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          rejectBody(new HttpError(413, '请求太大。'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        resolveBody(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
      })
      req.on('error', rejectBody)
    })
  }

  function readRoots(): string[] {
    return [activeCwd(), config.cwd, process.cwd()]
  }

  function resolveReadableFile(raw: string, roots: string[]): string {
    if (!raw) throw new HttpError(404, '没有指定文件。')
    const wanted = expandHome(raw)
    const file = isAbsolute(wanted) ? wanted : resolve(roots[0] || process.cwd(), wanted)
    if (!roots.some((root) => isInside(file, root))) {
      throw new HttpError(403, '这个文件不在可读目录里。')
    }
    if (!/\.(?:md|markdown)$/i.test(file)) throw new HttpError(400, '现在只支持 Markdown 预览。')
    return file
  }

  async function fileKind(file: string): Promise<FileRow['kind']> {
    const ext = extname(file).toLowerCase()
    if (ext === '.md' || ext === '.markdown') return 'md'
    if (TEXT_EXTS.has(ext)) return 'text'
    if (IMAGE_MIME[ext]) return 'image'
    // LICENSE, Makefile and friends have no extension, and a wrong
    // extension is common too, so fall back to sniffing the first block.
    if (BINARY_EXTS.has(ext)) return 'other'
    return (await looksLikeText(file)) ? 'text' : 'other'
  }

  async function looksLikeText(file: string): Promise<boolean> {
    let handle
    try {
      handle = await open(file, 'r')
    } catch (error) {
      return false
    }
    try {
      const buffer = Buffer.alloc(8192)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const sample = buffer.subarray(0, bytesRead)
      if (sample.includes(0)) return false
      const decoder = new TextDecoder('utf-8')
      const text = decoder.decode(sample)
      if (!text.includes('\uFFFD')) return true
      if (bytesRead < buffer.length) return false
      const trimmed = decoder.decode(sample.subarray(0, Math.max(0, bytesRead - 4)))
      return !trimmed.includes('\uFFFD')
    } catch (error) {
      return false
    } finally {
      await handle.close()
    }
  }

  async function listDirEntries(dir: string): Promise<FileRow[]> {
    let items
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      return []
    }
    const dirs: FileRow[] = []
    const files: FileRow[] = []
    for (const entry of items) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        dirs.push({ path: full, name: entry.name, relative: entry.name, dir: true, size: 0 })
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await stat(full)
        files.push({
          path: full,
          name: entry.name,
          relative: entry.name,
          size: info.size,
          updatedAt: info.mtimeMs,
          kind: await fileKind(full),
        })
      } catch (error) {}
    }
    const byName = (a: FileRow, b: FileRow) => a.name.localeCompare(b.name, 'zh')
    dirs.sort(byName)
    files.sort(byName)
    return dirs.concat(files).slice(0, 300)
  }

  async function resolveReadableText(raw: string, roots: string[]): Promise<string> {
    if (!raw) throw new HttpError(404, '没有指定文件。')
    const wanted = expandHome(raw)
    const file = isAbsolute(wanted) ? wanted : resolve(roots[0] || process.cwd(), wanted)
    if (!roots.some((root) => isInside(file, root))) {
      throw new HttpError(403, '这个文件不在可读目录里。')
    }
    if ((await fileKind(file)) !== 'text') throw new HttpError(400, '这个文件不是文本，不能预览。')
    return file
  }

  function renderErrorPage(status: number, message: unknown): string {
    return ui.renderError(config, status, errorText(message))
  }
}

function sendHtml(res: ServerResponse, status: number, html: string, extraCookie?: string) {
  const headers: Record<string, string | number> = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(html),
  }
  if (extraCookie) headers['set-cookie'] = extraCookie
  res.writeHead(status, headers)
  res.end(html)
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location, 'content-length': 0 })
  res.end()
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

const IMAGE_MAX_BYTES = 12 * 1024 * 1024

/**
 * Serves a local image file for `<img src="/img?p=…">`.
 *
 * The image stays in the browser's HTTP cache instead of being re-sent inside
 * every page render, which matters on e-ink: a full refresh re-renders the
 * whole document, and inline SVG sometimes comes back blank on the device.
 */
function serveLocalImage(
  roots: string[],
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): void {
  const raw = url.searchParams.get('p') || ''
  if (!raw) throw new HttpError(404, '没有指定图片。')
  const file = isAbsolute(raw) ? raw : resolve(roots[0] || process.cwd(), raw)
  const mime = IMAGE_MIME[extname(file).toLowerCase()]
  if (!mime) throw new HttpError(404, '不是图片。')
  const inside = roots.some((root) => file === root || file.startsWith(root + sep))
  if (!inside) throw new HttpError(403, '图片不在工作目录里。')

  let stat
  try {
    stat = statSync(file)
  } catch {
    throw new HttpError(404, '图片不存在。')
  }
  if (!stat.isFile()) throw new HttpError(404, '图片不存在。')
  if (stat.size > IMAGE_MAX_BYTES) throw new HttpError(413, '图片太大。')

  const etag = '"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"'
  const headers: Record<string, string> = {
    'content-type': mime,
    'cache-control': 'public, max-age=604800',
    etag,
    'content-length': String(stat.size),
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

function escapeText(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function errorText(error: unknown): string {
  return String((error as { message?: unknown } | null | undefined)?.message || error)
}

/**
 * Rotate the login token without restarting the Host.
 *
 * lib/hot.js hashes the token once at mount and is imported only once per
 * process, so editing .kindle-token alone would leave the old hash accepting
 * cookies until the next restart. createApp runs before respond() authorizes a
 * request, so updating host.auth here takes effect on the very next request.
 * Explicit config.token and DSH_KINDLE_TOKEN still win, exactly like the shell.
 */
async function syncAuthToken(host: KindleHost): Promise<void> {
  const config = host.config
  if (config.token && config.token !== 'off') return
  if (String(process.env.DSH_KINDLE_TOKEN || '').trim()) return
  try {
    const stored = (await readFile(join(config.cwd, '.kindle-token'), 'utf8')).trim()
    if (!stored) return
    // Assign both every time: an earlier buggy sync could have left the token
    // field already updated while the hash was in the wrong shape, and equality
    // on the token alone would then never repair it.
    host.auth.token = stored
    host.auth.hash = createHash('sha256').update(stored, 'utf8').digest()
  } catch {
    /* no token file: keep the hash the shell mounted with */
  }
}

interface FilesAccess {
  allowed(req: IncomingMessage): boolean
  notice(req: IncomingMessage): { error?: string; wait?: number; missing?: boolean }
  unlock(req: IncomingMessage, res: ServerResponse): Promise<void>
}

interface PinHash {
  salt: Buffer
  digest: Buffer
  cost: number
}

/**
 * Gates the file pages (/files, /f, /t, /i and /img) behind a six-digit PIN.
 *
 * The PIN itself is only stored as a scrypt hash in <cwd>/.kindle-files-pin.
 * The cookie holds an expiry plus an HMAC over it, so a forged or edited value
 * cannot extend the hour, and it is scoped separately from the login cookie:
 * a stolen session still cannot read files.
 */
async function createFilesAccess(
  config: KindleHost['config'],
  logger: KindleLogger,
): Promise<FilesAccess> {
  const ttl = clampInt(config.filesPinTtl, 60, 7 * 24 * 3600, FILES_PIN_TTL)
  const pinFile = join(config.cwd, FILES_PIN_FILE)
  let pin: PinHash | null = null
  if (config.filesPin && /^\d{6}$/.test(config.filesPin)) {
    pin = hashPin(config.filesPin)
  } else {
    try {
      pin = parsePin(await readFile(pinFile, 'utf8'))
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        logger.warn?.('kindle-ui: cannot read ' + pinFile + ': ' + errorText(error))
      }
      logger.warn?.('kindle-ui: file PIN missing (' + pinFile + '); file pages stay locked')
    }
  }
  const key = await loadFilesKey(join(config.cwd, FILES_KEY_FILE), logger)
  const failures = new Map<string, { count: number; until: number }>()

  function waitSeconds(req: IncomingMessage): number {
    const state = failures.get(clientKey(req))
    if (!state || state.until <= Date.now()) return 0
    return Math.ceil((state.until - Date.now()) / 1000)
  }

  return {
    allowed(req) {
      const raw = parseCookies(req.headers.cookie || '')[FILES_COOKIE]
      if (!raw) return false
      const dot = raw.indexOf('.')
      if (dot <= 0) return false
      const exp = Number(raw.slice(0, dot))
      if (!Number.isFinite(exp) || exp <= Date.now()) return false
      const want = createHmac('sha256', key)
        .update('files:' + exp)
        .digest()
      const got = Buffer.from(raw.slice(dot + 1), 'base64url')
      return got.length === want.length && timingSafeEqual(got, want)
    },
    notice(req) {
      const wait = waitSeconds(req)
      if (wait > 0) return { error: '尝试次数太多，请稍后再试。', wait }
      if (!pin) return { missing: true }
      return {}
    },
    async unlock(req, res) {
      const body = await readForm(req)
      const next = safeFileNext(String(body.get('next') || ''))
      const send = (extra: { error?: string; wait?: number; missing?: boolean }) =>
        sendHtml(res, 200, renderFilesPin(config, { next, ...extra }))

      const wait = waitSeconds(req)
      if (wait > 0) {
        send({ error: '尝试次数太多，请稍后再试。', wait })
        return
      }
      if (!pin) {
        send({ missing: true })
        return
      }
      const submitted = String(body.get('pin') || '').trim()
      if (!/^\d{6}$/.test(submitted) || !verifyPin(submitted, pin)) {
        const state = failures.get(clientKey(req)) || { count: 0, until: 0 }
        state.count += 1
        if (state.count >= 5) {
          state.count = 0
          state.until = Date.now() + 60_000
        }
        failures.set(clientKey(req), state)
        send({ error: '密码不对，再试一次。' })
        return
      }
      failures.delete(clientKey(req))
      const exp = Date.now() + ttl * 1000
      const sig = createHmac('sha256', key)
        .update('files:' + exp)
        .digest('base64url')
      res.writeHead(303, {
        location: next,
        'set-cookie':
          FILES_COOKIE +
          '=' +
          exp +
          '.' +
          sig +
          '; Path=/; Max-Age=' +
          ttl +
          '; HttpOnly; SameSite=Lax',
      })
      res.end()
    },
  }
}

function clientKey(req: IncomingMessage): string {
  return String(req.socket?.remoteAddress || 'local')
}

/** Only bounce back into the gated pages, never to an arbitrary host/path. */
function safeFileNext(value: string): string {
  const text = value.slice(0, 500)
  if (text.startsWith('//')) return '/files'
  return /^\/(?:files|f\?|t\?|i\?|img\?|settings\?hidden=1)/.test(text) ? text : '/files'
}

function readForm(req: IncomingMessage, limit = 64 * 1024): Promise<URLSearchParams> {
  return new Promise<URLSearchParams>((done, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        fail(new HttpError(413, '请求太大。'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => done(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', fail)
  })
}

function hashPin(pin: string, salt = randomBytes(16)): PinHash {
  const cost = 16384
  return { salt, cost, digest: scryptSync(pin, salt, 32, { N: cost, r: 8, p: 1 }) }
}

function parsePin(text: string): PinHash {
  const parts = String(text).trim().split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') throw new Error('bad PIN file')
  const cost = Number(parts[1])
  const salt = Buffer.from(parts[4], 'hex')
  const digest = Buffer.from(parts[5], 'hex')
  if (!Number.isInteger(cost) || cost < 1024 || !salt.length || digest.length !== 32) {
    throw new Error('bad PIN file')
  }
  return { salt, digest, cost }
}

function verifyPin(pin: string, stored: PinHash): boolean {
  try {
    const digest = scryptSync(pin, stored.salt, stored.digest.length, {
      N: stored.cost,
      r: 8,
      p: 1,
    })
    return timingSafeEqual(digest, stored.digest)
  } catch {
    return false
  }
}

async function loadFilesKey(file: string, logger: KindleLogger): Promise<Buffer> {
  try {
    const text = (await readFile(file, 'utf8')).trim()
    if (/^[0-9a-f]{64}$/i.test(text)) return Buffer.from(text, 'hex')
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      logger.warn?.('kindle-ui: cannot read ' + file + ': ' + errorText(error))
    }
  }
  const key = randomBytes(32)
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, key.toString('hex') + '\n', { mode: 0o600 })
  } catch (error) {
    logger.warn?.('kindle-ui: cannot persist the file cookie key: ' + errorText(error))
  }
  return key
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=')
    if (index === -1) continue
    const name = chunk.slice(0, index).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(chunk.slice(index + 1).trim())
    } catch {
      /* malformed cookie: ignore it */
    }
  }
  return out
}

interface StoredSettings {
  workspace: string
  indent?: boolean
  indentArt?: boolean
  hidden?: string[]
}

async function loadSettings(file: string): Promise<StoredSettings> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as {
      workspace?: unknown
      indent?: unknown
      indentArt?: unknown
      hidden?: unknown
    } | null
    const text = value && typeof value.workspace === 'string' ? expandHome(value.workspace) : ''
    const hidden =
      value && Array.isArray(value.hidden)
        ? [...new Set(value.hidden.filter((item): item is string => typeof item === 'string'))]
        : []
    return {
      workspace: text && isAbsolute(text) ? text : '',
      indent: Boolean(value && value.indent === true),
      indentArt: !(value && value.indentArt === false),
      hidden,
    }
  } catch (error) {
    return { workspace: '', hidden: [] }
  }
}

async function saveSettings(file: string, settings: StoredSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(settings) + '\n', 'utf8')
}

/** The same `~` expansion the plugin config uses, so the field accepts `~/x`. */
function expandHome(path: string): string {
  const text = String(path || '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return text
}

function isInside(file: string, root: string): boolean {
  return file === root || file.startsWith(root.endsWith(sep) ? root : root + sep)
}

function safeFrom(value: unknown): string {
  const text = String(value || '')
  return /^\/(?!\/)/.test(text) ? text.slice(0, 400) : ''
}

function searchQuery(value: unknown): string {
  return String(value || '')
    .trim()
    .slice(0, 60)
}

function filterSessions<T extends { title: string }>(sessions: T[], query: string): T[] {
  const needle = query.toLowerCase()
  return sessions.filter((item) => item.title.toLowerCase().includes(needle))
}

/**
 * Picks the last `size` conversational messages plus their tool rows.
 *
 * Tool events used to eat the window: one busy turn could push every real
 * message off the page. They collapse into a single link now, so only
 * user/assistant messages count towards the page size.
 */
function windowMessages(messages: readonly TranscriptMessage[], size: number): TranscriptMessage[] {
  let count = 0
  let start = messages.length
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].kind !== 'tool') {
      count += 1
      if (count > size) break
    }
    start = index
  }
  return messages.slice(start)
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}
