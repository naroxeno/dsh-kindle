import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, isAbsolute, resolve } from 'node:path'

const STAMP = new URL(import.meta.url).search
const { escapeHtml, texToSvg } = await import('./math.js' + STAMP)

export interface MarkdownOptions {
  fontPx?: number
  /** Base directory for relative links and images; set to the file's own dir when previewing one. */
  cwd?: string
  /** Page to return to from a file preview, carried through generated links. */
  from?: string
}

interface Piece {
  kind: 'text' | 'code' | 'math' | 'image'
  value: string
  display?: boolean
  alt?: string
}

export interface MarkdownHeading {
  level: number
  text: string
  /** Index into MarkdownDoc.blocks where this heading starts. */
  block: number
}

export interface MarkdownDoc {
  html: string
  blocks: string[]
  headings: MarkdownHeading[]
}

export function renderMarkdown(src: string, opts: MarkdownOptions = {}): string {
  return renderMarkdownDoc(src, opts).html
}

/** Same renderer, but keeps the block list so a caller can build a table of contents. */
export function renderMarkdownDoc(src: string, opts: MarkdownOptions = {}): MarkdownDoc {
  const fontPx = opts.fontPx || 30
  const text = String(src || '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const blocks: string[] = []
  const headings: MarkdownHeading[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    const fence = /^\s{0,3}```\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^\s{0,3}```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(`<pre class="code">${escapeHtml(body.join('\n'))}</pre>`)
      continue
    }

    if (/^\s{0,3}\$\$\s*$/.test(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^\s{0,3}\$\$\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(displayMath(body.join('\n'), fontPx))
      continue
    }

    if (/^\s*$/.test(line)) {
      i += 1
      continue
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6)
      blocks.push(`<h${level}>${inline(heading[2], fontPx, opts)}</h${level}>`)
      headings.push({ level, text: heading[2].trim(), block: blocks.length - 1 })
      i += 1
      continue
    }

    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push('<hr>')
      i += 1
      continue
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s{0,3}>\s?/, ''))
        i += 1
      }
      blocks.push(`<blockquote>${renderMarkdown(quoted.join('\n'), opts)}</blockquote>`)
      continue
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i])
      const rows: string[][] = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      blocks.push(renderTable(head, rows, fontPx, opts))
      continue
    }

    const bullet = /^\s{0,3}([-*+])\s+(.*)$/.exec(line)
    if (bullet) {
      const items: string[] = []
      while (i < lines.length) {
        const m = /^\s{0,3}([-*+])\s+(.*)$/.exec(lines[i])
        if (!m) break
        let item = m[2]
        i += 1
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !/^\s{0,3}([-*+]|\d+[.)])\s+/.test(lines[i])
        ) {
          item += ' ' + lines[i].trim()
          i += 1
        }
        items.push(`<li>${inline(item, fontPx, opts)}</li>`)
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    const ordered = /^\s{0,3}\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      const items: string[] = []
      while (i < lines.length) {
        const m = /^\s{0,3}\d+[.)]\s+(.*)$/.exec(lines[i])
        if (!m) break
        items.push(`<li>${inline(m[1], fontPx, opts)}</li>`)
        i += 1
      }
      blocks.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    const lone = /^\s{0,3}!\[([^\]\n]{0,200})\]\(([^)\s]{1,2000})\)\s*$/.exec(line)
    if (lone) {
      blocks.push(imageHtml(lone[2], lone[1], opts.cwd, opts.from))
      i += 1
      continue
    }

    const para: string[] = []
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines, i)) {
      para.push(lines[i])
      i += 1
    }
    if (para.length === 0) {
      para.push(lines[i])
      i += 1
    }
    blocks.push(`<p>${inline(para.join('\n'), fontPx, opts)}</p>`)
  }

  return { html: blocks.join('\n'), blocks, headings }
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i]
  return (
    /^\s{0,3}```/.test(line) ||
    /^\s{0,3}\$\$\s*$/.test(line) ||
    /^\s{0,3}(#{1,6})\s+/.test(line) ||
    /^\s{0,3}>/.test(line) ||
    /^\s{0,3}([-*+])\s+/.test(line) ||
    /^\s{0,3}\d+[.)]\s+/.test(line) ||
    /^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line) ||
    isTableStart(lines, i)
  )
}

function isTableStart(lines: string[], i: number): boolean {
  if (!/^\s*\|.*\|\s*$/.test(lines[i] || '')) return false
  const next = lines[i + 1] || ''
  return /^\s*\|[\s:|-]+\|\s*$/.test(next) && next.indexOf('-') !== -1
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
}

function renderTable(
  head: string[],
  rows: string[][],
  fontPx: number,
  opts: MarkdownOptions,
): string {
  if (head.length === 0 && rows.length === 0) return ''
  const headHtml = head.length
    ? `<tr>${head.map((c) => `<th>${inline(c, fontPx, opts)}</th>`).join('')}</tr>`
    : ''
  const body = rows
    .map(
      (cells) =>
        '<tr>' + cells.map((c) => `<td>${inline(c, fontPx, opts)}</td>`).join('') + '</tr>',
    )
    .join('')
  return `<table>${headHtml}${body}</table>`
}

function displayMath(tex: string, fontPx: number): string {
  return `<div class="mathblock">${texToSvg(tex, { display: true, fontPx })}</div>`
}

export function inline(text: string, fontPx = 30, opts: MarkdownOptions = {}): string {
  const pieces: Piece[] = []
  let i = 0
  let buffer = ''

  const flushText = () => {
    if (buffer) {
      pieces.push({ kind: 'text', value: buffer })
      buffer = ''
    }
  }

  while (i < text.length) {
    const ch = text[i]

    if (ch === '`') {
      let run = 0
      while (text[i + run] === '`') run += 1
      const fence = text.slice(i, i + run)
      let close = -1
      let at = text.indexOf(fence, i + run)
      while (at !== -1) {
        let len = 0
        while (text[at + len] === '`') len += 1
        if (len === run) {
          close = at
          break
        }
        at = text.indexOf(fence, at + len)
      }
      if (close !== -1 && close > i + run) {
        flushText()
        let value = text.slice(i + run, close)
        if (
          value.length > 2 &&
          value[0] === ' ' &&
          value[value.length - 1] === ' ' &&
          value.trim()
        ) {
          value = value.slice(1, -1)
        }
        pieces.push({ kind: 'code', value })
        i = close + run
        continue
      }
    }

    if (ch === '!' && text[i + 1] === '[') {
      const image = /^!\[([^\]\n]{0,200})\]\(([^)\s]{1,2000})\)/.exec(text.slice(i))
      if (image) {
        flushText()
        pieces.push({ kind: 'image', value: image[2], alt: image[1] })
        i += image[0].length
        continue
      }
    }

    if (ch === '\\' && (text[i + 1] === '(' || text[i + 1] === '[')) {
      const open = text[i + 1]
      const closeToken = open === '(' ? '\\)' : '\\]'
      const close = text.indexOf(closeToken, i + 2)
      if (close !== -1) {
        flushText()
        pieces.push({ kind: 'math', value: text.slice(i + 2, close), display: open === '[' })
        i = close + 2
        continue
      }
    }

    if (ch === '$') {
      const display = text[i + 1] === '$'
      const delim = display ? '$$' : '$'
      const close = findDelimiter(text, i + delim.length, delim)
      if (close !== -1) {
        flushText()
        pieces.push({ kind: 'math', value: text.slice(i + delim.length, close), display })
        i = close + delim.length
        continue
      }
    }

    buffer += ch
    i += 1
  }
  flushText()

  return pieces
    .map((piece) => {
      if (piece.kind === 'image')
        return imageHtml(piece.value, piece.alt || '', opts.cwd, opts.from)
      if (piece.kind === 'code') return codeHtml(piece.value, opts)
      if (piece.kind === 'math') {
        const svg = texToSvg(piece.value, { display: piece.display, fontPx })
        return piece.display ? `<span class="mathblock-inline">${svg}</span>` : svg
      }
      return emphasis(escapeHtml(piece.value), opts)
    })
    .join('')
}

function findDelimiter(text: string, from: number, delim: string): number {
  let i = from
  while (i < text.length) {
    if (text.startsWith(delim, i) && text[i - 1] !== '\\') return i
    i += 1
  }
  return -1
}

function codeHtml(value: string, opts: MarkdownOptions): string {
  const target = resolveLocalTarget(value, opts.cwd)
  const code = `<code>${escapeHtml(value)}</code>`
  return target ? `<a href="${escapeAttribute(targetHref(target, opts))}">${code}</a>` : code
}

function emphasis(escaped: string, opts: MarkdownOptions): string {
  let out = escaped
  out = out.replace(/\[([^\]]{1,200})\]\(([^)\s]{1,500})\)/g, (m, label, href) => {
    const target = resolveLocalTarget(href, opts.cwd)
    if (target) return `<a href="${escapeAttribute(targetHref(target, opts))}">${label}</a>`
    if (/^(?:https?:|mailto:)/i.test(href)) {
      return `<a href="${escapeAttribute(href)}">${label}</a>`
    }
    // A relative path that is not a readable file would resolve against the
    // current route and 404 on tap; show the label as text instead.
    return label.replace(/^\[(.*)\]$/, '$1')
  })
  out = out.replace(
    /(^|[\s(（【「『"'、，。：；:])([^\s<>"'()?，。；、！？」』]{1,300}\.(?:md|markdown|png|jpe?g|gif|svg|webp))(?=$|[\s)）】」』"'、，。：；:])/gi,
    (match, lead: string, token: string) => {
      if (token.indexOf('://') !== -1 || token.startsWith('//')) return match
      const target = resolveLocalTarget(token, opts.cwd)
      if (!target) return match
      return lead + `<a href="${escapeAttribute(targetHref(target, opts))}">${token}</a>`
    },
  )
  out = out.replace(/(^|[\s(])((?:https?|mailto):[^\s<>()]{4,300})/g, (m, lead, url) => {
    return `${lead}<a href="${escapeAttribute(url)}">${url}</a>`
  })
  out = out.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]{1,300})\*/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^\w_])_([^_\n]{1,300})_(?=[^\w_]|$)/g, '$1<em>$2</em>')
  return out
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

const MARKDOWN_EXT = /\.(?:md|markdown)$/i
const FILE_CACHE = new Map<string, { ok: boolean; at: number }>()

function isMarkdownFile(path: string): boolean {
  const now = Date.now()
  const cached = FILE_CACHE.get(path)
  if (cached && now - cached.at < 10_000) return cached.ok
  let ok = false
  try {
    ok = statSync(path).isFile()
  } catch {
    ok = false
  }
  FILE_CACHE.set(path, { ok, at: now })
  if (FILE_CACHE.size > 128) FILE_CACHE.clear()
  return ok
}

/** A link target that names an existing local Markdown file, resolved against `cwd`. */
export function resolveMarkdownPath(raw: string, cwd?: string): string | null {
  let href = String(raw || '').trim()
  if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1).trim()
  if (!href || href.length > 400) return null
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return null
  if (!MARKDOWN_EXT.test(href)) return null
  if (href.startsWith('~')) href = homedir() + href.slice(1)
  const path = isAbsolute(href) ? href : resolve(cwd || process.cwd(), href)
  return isMarkdownFile(path) ? path : null
}

function fileHref(path: string, opts: MarkdownOptions): string {
  const from = opts.from ? '&from=' + encodeURIComponent(opts.from) : ''
  return '/f?p=' + encodeURIComponent(path) + from
}

type LocalTarget = { path: string; kind: 'md' | 'image' }

const TARGET_CACHE = new Map<string, { target: LocalTarget | null; at: number }>()

/** Resolve a link target to a local Markdown file or image, or null when it is not one. */
export function resolveLocalTarget(raw: string, cwd?: string): LocalTarget | null {
  let href = String(raw || '').trim()
  if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1).trim()
  if (!href || href.length > 400) return null
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return null
  const isMd = MARKDOWN_EXT.test(href)
  const ext = extname(href.split(/[?#]/)[0]).toLowerCase()
  const isImage = IMAGE_EXTS.has(ext)
  if (!isMd && !isImage) return null
  if (href.startsWith('~')) href = homedir() + href.slice(1)
  const path = isAbsolute(href) ? href : resolve(cwd || process.cwd(), href)
  const cached = TARGET_CACHE.get(path)
  const now = Date.now()
  if (cached && now - cached.at < 10_000) {
    return cached.target
  }
  let target: LocalTarget | null = null
  try {
    if (statSync(path).isFile()) target = { path, kind: isMd ? 'md' : 'image' }
  } catch {
    target = null
  }
  if (TARGET_CACHE.size > 128) TARGET_CACHE.clear()
  TARGET_CACHE.set(path, { target, at: now })
  return target
}

/** Link used for an image preview page, which unlike #anchors works on the Kindle. */
export function imageHref(path: string, opts: MarkdownOptions): string {
  const from = opts.from ? '&from=' + encodeURIComponent(opts.from) : ''
  return '/i?p=' + encodeURIComponent(path) + from
}

function targetHref(target: LocalTarget, opts: MarkdownOptions): string {
  return target.kind === 'md' ? fileHref(target.path, opts) : imageHref(target.path, opts)
}

const IMAGE_EXTS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp'])
const IMAGE_CACHE = new Map<string, { key: string; html: string }>()
const IMAGE_CACHE_LIMIT = 32

/** ![alt](src) -> inline SVG (line art) or a data URI (raster), so e-ink clients need no extra route. */
function imageHtml(src: string, alt: string, cwd?: string, from?: string): string {
  const label = alt ? escapeHtml(alt).trim() : ''
  let href = src.trim()
  if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1).trim()
  const missing = `<span class="figmiss">${label ? '[' + label + ']' : '[图]'}</span>`
  if (!href) return missing
  if (/^(https?:\/\/|data:)/i.test(href)) {
    return `<figure class="fig"><img src="${escapeAttribute(href)}" alt="${label}"></figure>`
  }
  const path = resolve(cwd || process.cwd(), href)
  const ext = extname(path).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) return missing
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return missing
    const key = `${stat.size}:${Math.floor(stat.mtimeMs)}:${from || ''}`
    const page =
      '/i?p=' + encodeURIComponent(path) + (from ? '&from=' + encodeURIComponent(from) : '')
    const cached = IMAGE_CACHE.get(path)
    if (cached && cached.key === key) return cached.html
    let html: string
    if (ext === '.svg') {
      if (stat.size > 400 * 1024) return missing
      let svg = readFileSync(path, 'utf8')
      svg = svg.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '')
      if (/<script|\son[a-z]+\s*=/i.test(svg)) return missing
      html = `<figure class="fig" role="img" aria-label="${label}"><a href="${escapeAttribute(page)}">${svg}</a></figure>`
    } else {
      if (stat.size > 8 * 1024 * 1024) return missing
      const version = Math.floor(stat.mtimeMs).toString(36)
      const url = `/img?p=${encodeURIComponent(path)}&v=${version}`
      html = `<figure class="fig"><a href="${escapeAttribute(page)}"><img src="${escapeAttribute(url)}" alt="${label}"></a></figure>`
    }
    IMAGE_CACHE.set(path, { key, html })
    if (IMAGE_CACHE.size > IMAGE_CACHE_LIMIT) IMAGE_CACHE.clear()
    return html
  } catch {
    return missing
  }
}
