/**
 * dsh-kindle — the stable shell.
 *
 * The Host imports index.js once per process, and that module graph is frozen:
 * rewriting lib/*.js on disk does not change modules the process already
 * imported. Restarting the Host to pick up a page tweak aborts in-flight agent
 * turns, which is exactly what a long-running Kindle session cannot afford.
 *
 * So the plugin is split in two layers:
 *
 *   - index.js + hot.js: imported once, never change shape. They own the
 *     config, the token, the HTTP listener and the session cookie.
 *   - app.js + sessions/ui/markdown/math/account/prompt.js: the "generations".
 *     hot.js re-imports app.js as app.js?gen=N whenever the on-disk
 *     fingerprint of those files changes; app.js pulls its siblings with the
 *     same suffix, so one generation never mixes two copies of a module.
 *
 * The listener and the cookie survive; only the code behind a request is
 * swapped. A failed load keeps the previous generation serving and records the
 * error for /debug.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, networkInterfaces } from 'node:os'
import { join, resolve } from 'node:path'

/** Bumped on behaviour changes so /debug can confirm what is actually running. */
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const DEFAULTS = {
  host: '0.0.0.0',
  port: 8090,
  token: '',
  cwd: '~/kindle-ws',
  fontSize: 30,
  pageSize: 6,
  hotReload: true,
}

/** A change to any of these starts a new generation. */
const HOT_FILES = ['app.js', 'generation.js', 'sessions.js', 'ui.js', 'markdown.js', 'math.js', 'account.js', 'prompt.js']
const LIB = new URL('./', import.meta.url)
const PROMPT_FILE = new URL('../prompt/kindle.md', import.meta.url)

/** stat() at most this often per request burst. */
const CHECK_INTERVAL = 250
/** After a failed load, wait this long before retrying the same broken tree. */
const FAILURE_BACKOFF = 750

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Owns the current generation of the Kindle app.
 *
 * Reloads are lazy: a request checks the fingerprint of the hot files (cheap
 * stat() calls, throttled) and, if something changed, imports a fresh app.js
 * before it renders. An idle Kindle costs nothing.
 */
class HotRuntime {
  constructor(options) {
    this.ctx = options.ctx
    this.config = options.config
    this.auth = options.auth
    this.services = options.services
    this.logger = options.logger
    this.auto = options.config.hotReload !== false
    this.generation = 0
    this.reloads = 0
    this.lastError = ''
    this.current = null
    this.loading = null
    this.seen = ''
    /** Fingerprint that last failed to load; don't re-import a known-broken tree. */
    this.failedFingerprint = ''
    this.checkedAt = 0
    this.attemptAt = 0
    this.closed = false
    this.host = {
      ctx: this.ctx,
      config: this.config,
      auth: this.auth,
      services: this.services,
      logger: this.logger,
      version: VERSION,
      hot: () => this.status(),
    }
  }

  status() {
    return {
      generation: this.generation,
      reloads: this.reloads,
      auto: this.auto,
      lastError: this.lastError,
      version: VERSION,
    }
  }

  /** Plain-text /debug body when no generation could ever be loaded. */
  debugText() {
    const lines = [
      'kindle-ui ' + VERSION,
      'hot: generation ' + this.generation + (this.auto ? '' : ' (auto off)'),
      this.lastError ? 'hot error: ' + this.lastError : 'hot error: none',
    ]
    return lines.join('\n')
  }

  /** mtime+size of every hot file: content edits change it, touch alone too. */
  fingerprint() {
    const parts = []
    for (const file of HOT_FILES) parts.push(statStamp(new URL(file, LIB)))
    parts.push(statStamp(PROMPT_FILE))
    return parts.join('|')
  }

  /** Optional services came or went: hand the live object to the current app. */
  syncHost() {
    if (!this.current || typeof this.current.setHost !== 'function') return
    try {
      this.current.setHost(this.services)
    } catch (error) {
      this.logger.warn?.('kindle-ui: host sync failed: ' + messageOf(error))
    }
  }

  /** The app instance this request should run on, reloading first if needed. */
  async get() {
    if (this.closed) return null
    if (this.loading) {
      try {
        await this.loading
      } catch {
        /* reload() records its own errors */
      }
    }
    if (!this.current) {
      // A tree that already failed to import is not retried until it changes on
      // disk: each attempt would pin another rejected module URL in the registry.
      if (this.failedFingerprint && this.failedFingerprint === this.fingerprint()) return null
      if (Date.now() - this.attemptAt < FAILURE_BACKOFF) return null
      await this.reload('initial')
      return this.current
    }
    if (this.auto && Date.now() - this.checkedAt >= CHECK_INTERVAL && this.fingerprint() !== this.seen) {
      await this.reload('changed')
    }
    return this.current
  }

  reload(reason) {
    if (this.closed) return Promise.resolve(this.current)
    if (this.loading) return this.loading
    this.loading = this.loadGeneration(reason).finally(() => {
      this.loading = null
    })
    return this.loading
  }

  async loadGeneration(reason) {
    const at = Date.now()
    this.attemptAt = at
    const fingerprint = this.fingerprint()
    const generation = this.generation + 1
    const specifier = new URL('app.js?gen=' + generation + '&t=' + at.toString(36), LIB).href
    let app
    try {
      const module = await import(specifier)
      app = await module.createApp(this.host)
    } catch (error) {
      this.lastError = new Date(at).toISOString() + ' ' + reason + ': ' + messageOf(error)
      // Same broken tree: do not retry on every request, only once it changes.
      this.seen = fingerprint
      this.failedFingerprint = fingerprint
      this.checkedAt = Date.now()
      this.logger.error?.('kindle-ui: generation ' + generation + ' failed to load (' + reason + '): ' + detailOf(error))
      return this.current
    }
    if (this.closed) {
      try {
        app.dispose()
      } catch {
        /* nothing to clean up */
      }
      return this.current
    }
    const previous = this.current
    this.current = app
    this.generation = generation
    this.seen = fingerprint
    this.failedFingerprint = ''
    this.checkedAt = Date.now()
    this.lastError = ''
    if (reason !== 'initial') this.reloads += 1
    if (previous) {
      try {
        previous.dispose()
      } catch (error) {
        this.logger.warn?.('kindle-ui: disposing the previous generation failed: ' + messageOf(error))
      }
    }
    this.logger.info?.(
      'kindle-ui: generation ' + generation + ' active (' + reason + ', ' + this.reloads + ' reload' + (this.reloads === 1 ? '' : 's') + ')',
    )
    return app
  }

  close() {
    this.closed = true
    const app = this.current
    this.current = null
    if (app) {
      try {
        app.dispose()
      } catch {
        /* ignore */
      }
    }
  }
}

export function mount(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const logger = typeof ctx.logger === 'function' ? ctx.logger('kindle-ui') : console
  const auth = { token: '', hash: null }
  const services = {
    sessionController: ctx.sessionController,
    workspaceController: null,
    workspaceRegistry: null,
    llm: null,
    accountController: null,
  }
  const runtime = new HotRuntime({ ctx, config, auth, services, logger })
  let server = null
  let disposed = false

  // Archiving is a nice-to-have: the workspace services sit in their own
  // inject scope so a profile without the workspace extension still gets a
  // reader instead of a plugin that never activates.
  ctx.inject(['workspaceController', 'workspaceRegistry'], (scope) => {
    services.workspaceController = scope.workspaceController
    services.workspaceRegistry = scope.workspaceRegistry
    runtime.syncHost()
    scope.effect(() => () => {
      services.workspaceController = null
      services.workspaceRegistry = null
      runtime.syncHost()
    }, 'kindle-ui: workspace services')
  })

  // Reasoning-effort levels come from the adapter that owns the route (the
  // model catalog leaves 'reasoning' out for several adapters), so hold the
  // llm service too. Optional, like the others: without it the row just hides.
  ctx.inject(['llm'], (scope) => {
    services.llm = scope.llm
    runtime.syncHost()
    scope.effect(() => () => {
      services.llm = null
      runtime.syncHost()
    }, 'kindle-ui: llm service')
  })

  // The account page is optional too: without the account extension the
  // balance simply does not render, and everything else keeps working.
  ctx.inject(['accountController'], (scope) => {
    services.accountController = scope.accountController
    runtime.syncHost()
    scope.effect(() => () => {
      services.accountController = null
      runtime.syncHost()
    }, 'kindle-ui: account service')
  })

  const ready = (async () => {
    const token = await resolveToken(config, logger)
    auth.token = token
    auth.hash = token ? sha256(token) : null
    if (disposed) return

    server = createServer((req, res) => {
      respond(req, res, { config, auth, runtime }).catch((error) => {
        logger.error?.(detailOf(error))
        if (res.headersSent) {
          res.destroy()
          return
        }
        const status = error instanceof HttpError ? error.status : 500
        sendHtml(res, status, bootPage(config, status, messageOf(error)))
      })
    })
    server.keepAliveTimeout = 1000
    server.headersTimeout = 10000
    server.on('clientError', (error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    })
    server.on('error', (error) => logger.error?.('kindle UI listener failed: ' + error.message))
    server.listen(config.port, config.host, () => {
      const base = 'http://' + lanAddress(config.host) + ':' + config.port
      logger.info?.(
        'kindle UI listening on ' + base + '/s (workspace ' + config.cwd + ', hot reload ' + (runtime.auto ? 'on' : 'off') + ')',
      )
      if (token) logger.info?.('kindle login link (open once on the device): ' + base + '/login?t=' + token)
    })
    // Warm the first generation while the browser is still connecting.
    runtime.reload('initial').catch(() => {})
  })().catch((error) => {
    logger.error?.('kindle UI disabled: ' + messageOf(error))
  })

  ctx.effect(() => () => {
    disposed = true
    runtime.close()
    if (server) server.close()
  }, 'kindle-ui: http listener')

  return ready
}

async function respond(req, res, options) {
  const { config, auth, runtime } = options
  const url = new URL(req.url || '/', 'http://kindle.invalid')
  const path = url.pathname
  const method = (req.method || 'GET').toUpperCase()

  // WebKit 534 reuses sockets that this process has already dropped, and then
  // shows its own "无法打开页面" instead of retrying. One request per
  // connection is the cheap, boring way to never hit that.
  res.setHeader('connection', 'close')

  if (path === '/favicon.ico') {
    res.writeHead(204).end()
    return
  }

  let app = await runtime.get()
  const check = authorized(req, url, auth)
  if (!check.ok) {
    if (method === 'POST' && path === '/login') {
      const body = await readBody(req)
      const submitted = String(body.get('token') || '')
      if (auth.hash && matches(submitted, auth.hash)) {
        res.writeHead(303, {
          'set-cookie': authCookie(submitted),
          Location: safeNext(String(body.get('next') || '/s')),
        })
        res.end()
        return
      }
      const page = app ? app.loginPage('/s', { error: true }) : bootPage(config, 403, '登录失败：口令不对。')
      sendHtml(res, 403, page, 'kd=; Path=/; Max-Age=0')
      return
    }
    sendHtml(res, 401, app ? app.loginPage(path + url.search) : bootPage(config, 401, '需要访问令牌。'))
    return
  }

  // The printed login link is /login?t=<token>: a single visit stores the
  // cookie, so the 2010-era browser never has to type a secret on an e-ink
  // keyboard more than once.
  if (check.viaQuery) res.setHeader('set-cookie', authCookie(auth.token))

  if (!app) {
    const message = runtime.lastError
      ? 'Kindle UI 的代码加载失败，暂时没有可用的上一代。修好后刷新即可。\n\n' + runtime.lastError
      : 'Kindle UI 正在启动，请稍后刷新。'
    if (path === '/debug') {
      sendText(res, 503, runtime.debugText() + '\n\n' + message + '\n')
      return
    }
    sendHtml(res, 503, bootPage(config, 503, message))
    return
  }

  // /debug?reload=1 forces one swap without waiting for a file change; handy
  // while working on a page that is already open on the device.
  if (method === 'GET' && path === '/debug' && url.searchParams.get('reload') === '1') {
    await runtime.reload('manual')
    // Report from the new generation, not the one that served this request.
    if (runtime.current) app = runtime.current
  }

  await app.handle(req, res)
}

function normalizeConfig(rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig || {}) }
  config.cwd = expandHome(config.cwd)
  config.fontSize = clampInt(config.fontSize, 20, 48, DEFAULTS.fontSize)
  config.pageSize = clampInt(config.pageSize, 1, 30, DEFAULTS.pageSize)
  config.hotReload = config.hotReload !== false
  return config
}

function statStamp(url) {
  try {
    const stat = statSync(url)
    return stat.size + ':' + stat.mtimeMs
  } catch {
    return 'missing'
  }
}

function authorized(req, url, auth) {
  if (!auth.hash) return { ok: true, viaQuery: false }
  const cookies = parseCookies(req.headers.cookie || '')
  if (cookies.kd && matches(cookies.kd, auth.hash)) return { ok: true, viaQuery: false }
  const query = url.searchParams.get('t')
  if (query && matches(query, auth.hash)) return { ok: true, viaQuery: true }
  return { ok: false, viaQuery: false }
}

function authCookie(token) {
  return 'kd=' + encodeURIComponent(token) + '; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax'
}

/**
 * Token resolution, in order: config.token, DSH_KINDLE_TOKEN, a persisted
 * <cwd>/.kindle-token, else a freshly generated one written there. Keeping
 * the secret out of the bundle patch means the repository stays shareable and
 * the device keeps one stable cookie across Host restarts.
 */
async function resolveToken(config, logger) {
  const explicit = String(config.token || '').trim()
  if (explicit === 'off') {
    logger.warn?.('kindle UI authentication disabled by config (token: off)')
    return ''
  }
  if (explicit) return explicit

  const fromEnv = String(process.env.DSH_KINDLE_TOKEN || '').trim()
  if (fromEnv) return fromEnv

  const file = join(config.cwd, '.kindle-token')
  try {
    const stored = (await readFile(file, 'utf8')).trim()
    if (stored) return stored
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn?.('cannot read ' + file + ': ' + error.message)
  }

  const generated = randomBytes(24).toString('base64url')
  try {
    await mkdir(config.cwd, { recursive: true })
    await writeFile(file, generated + '\n', { mode: 0o600 })
    logger.info?.('kindle UI token generated in ' + file)
  } catch (error) {
    logger.warn?.('cannot persist token to ' + file + ': ' + error.message + ' (it will change on restart)')
  }
  return generated
}

/** The address a phone or Kindle on the LAN can actually reach. */
function lanAddress(host) {
  if (host && host !== '0.0.0.0' && host !== '::') return host
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return '127.0.0.1'
}

function parseCookies(header) {
  const out = {}
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=')
    if (index === -1) continue
    const key = chunk.slice(0, index).trim()
    const value = chunk.slice(index + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest()
}

function matches(value, expected) {
  const digest = sha256(value)
  return digest.length === expected.length && timingSafeEqual(digest, expected)
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
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

function sendHtml(res, status, html, extraCookie) {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(html),
  }
  if (extraCookie) headers['set-cookie'] = extraCookie
  res.writeHead(status, headers)
  res.end(html)
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function safeNext(value) {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/s'
}

/** The page shown while no generation could be loaded at all. */
function bootPage(config, status, message) {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>出错了</title>' +
    '<style>body{font-family:serif;font-size:' + config.fontSize + 'px;padding:24px;line-height:1.6}' +
    'a{color:#0b3d91}pre{white-space:pre-wrap}</style>' +
    '</head><body><h1>' + status + '</h1><pre>' + escapeText(message) + '</pre>' +
    '<p><a href="/s">返回会话列表</a></p></body></html>'
}

function escapeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function expandHome(value) {
  const text = String(value || '')
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return resolve(homedir(), text.slice(2))
  return resolve(text)
}

function clampInt(value, min, max, fallback) {
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function messageOf(error) {
  if (!error) return 'unknown error'
  if (error instanceof Error) return error.message
  return String(error)
}

function detailOf(error) {
  if (error && error.stack) return String(error.stack).split('\n').slice(0, 4).join(' | ')
  return messageOf(error)
}
