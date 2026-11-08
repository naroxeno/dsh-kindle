import { createReadStream, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Generation } from './generation.js'
import type { KindleApp, KindleContext, KindleHost, ModelChoice } from './host.js'
import type { Transcript, TranscriptMessage, WorkspaceEntry } from './sessions.js'
import type { FileRow, ListExtras, SettingsNotice, SettingsView } from './ui.js'

const STAMP = new URL(import.meta.url).search
const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version

const LIST_MAX = 60
const FILE_PAGE_SIZE = 60
const MARKDOWN_MAX_BYTES = 1024 * 1024

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
  // The indent is a Kindle UI preference; hang it on the config every renderer
  // already receives so no page can disagree with another.
  config.indent = Boolean(settings.indent)
  const activeCwd = (): string => settings.workspace || config.cwd

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
      sendHtml(
        res,
        200,
        ui.renderSettings(
          config,
          await settingsView(noticeFor(url), searchQuery(url.searchParams.get('q'))),
        ),
      )
      return
    }

    if (method === 'POST' && path === '/settings') {
      const body = await readBody(req)
      if (String(body.get('action') || '') === 'filter') {
        const wanted = searchQuery(body.get('q'))
        redirect(res, wanted ? '/settings?q=' + encodeURIComponent(wanted) : '/settings')
        return
      }
      if (String(body.get('action') || '') === 'indent') {
        settings.indent = String(body.get('value') || '') === 'on'
        config.indent = settings.indent
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
        redirect(res, '/settings?ok=indent')
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
      const root = activeCwd()
      const rows = await listMarkdownFiles(root)
      sendHtml(
        res,
        200,
        ui.renderFiles(config, {
          ...(sessionId ? { sessionId } : {}),
          workspace: await workspaceLabel(),
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
    dispose() {},
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

  async function settingsView(notice?: SettingsNotice, query?: string): Promise<SettingsView> {
    const path = activeCwd()
    const list = (await sessionsApi.listWorkspaces()) || []
    const current = list.find((entry) => entry.path === path)
    const sessions = await sessionsApi.listSessions(ctx, path)
    const member = new Set(current ? current.sessionIds : [])
    const needle = (query || '').toLowerCase()
    const shown = needle
      ? list.filter(
          (entry) =>
            (entry.title || '').toLowerCase().includes(needle) ||
            entry.path.toLowerCase().includes(needle),
        )
      : list
    return {
      path,
      title: current && current.title ? current.title : basename(path) || path,
      registered: Boolean(current),
      registryReady: Boolean(services.workspaceRegistry && services.workspaceRegistry.list),
      query,
      choices: shown.map((entry) => ({
        id: entry.id,
        path: entry.path,
        title: entry.title || basename(entry.path) || entry.path,
        current: entry.path === path,
      })),
      ungrouped: sessions.filter((item) => !member.has(item.sessionId)).length,
      indent: Boolean(settings.indent),
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
      return { text: config.indent ? '正文改为段首缩进 2em。' : '正文改回不缩进。' }
    }
    if (ok === 'adopted') {
      const count = Math.max(0, Number(url.searchParams.get('n')) || 0)
      return {
        text: count
          ? '已把 ' + count + ' 个会话归入当前工作区。'
          : '当前工作区里没有需要归组的会话。',
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

  async function listMarkdownFiles(root: string): Promise<FileRow[]> {
    const rows: FileRow[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 3 || rows.length >= 200) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (error) {
        return
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
          await walk(full, depth + 1)
          continue
        }
        if (!entry.isFile() || !/\.(?:md|markdown)$/i.test(entry.name)) continue
        try {
          const info = await stat(full)
          rows.push({
            path: full,
            name: entry.name,
            relative: relative(root, full),
            size: info.size,
            updatedAt: info.mtimeMs,
          })
        } catch (error) {}
      }
    }
    await walk(root, 0)
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    return rows
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

interface StoredSettings {
  workspace: string
  indent?: boolean
}

async function loadSettings(file: string): Promise<StoredSettings> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as {
      workspace?: unknown
      indent?: unknown
    } | null
    const text = value && typeof value.workspace === 'string' ? expandHome(value.workspace) : ''
    return {
      workspace: text && isAbsolute(text) ? text : '',
      indent: Boolean(value && value.indent === true),
    }
  } catch (error) {
    return { workspace: '' }
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
