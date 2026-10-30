const STAMP = new URL(import.meta.url).search
const { escapeHtml, texToSvg } = await import('./math.js' + STAMP)

export interface MarkdownOptions {
  fontPx?: number
}

interface Piece {
  kind: 'text' | 'code' | 'math'
  value: string
  display?: boolean
}

export function renderMarkdown(src: string, opts: MarkdownOptions = {}): string {
  const fontPx = opts.fontPx || 30
  const text = String(src || '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const blocks: string[] = []
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
      blocks.push(`<h${level}>${inline(heading[2], fontPx)}</h${level}>`)
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
      const rows: string[][] = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      blocks.push(renderTable(rows, fontPx))
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
        items.push(`<li>${inline(item, fontPx)}</li>`)
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
        items.push(`<li>${inline(m[1], fontPx)}</li>`)
        i += 1
      }
      blocks.push(`<ol>${items.join('')}</ol>`)
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
    blocks.push(`<p>${inline(para.join('\n'), fontPx)}</p>`)
  }

  return blocks.join('\n')
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

function renderTable(rows: string[][], fontPx: number): string {
  if (rows.length === 0) return ''
  const body = rows
    .map((cells) => '<tr>' + cells.map((c) => `<td>${inline(c, fontPx)}</td>`).join('') + '</tr>')
    .join('')
  return `<table>${body}</table>`
}

function displayMath(tex: string, fontPx: number): string {
  return `<div class="mathblock">${texToSvg(tex, { display: true, fontPx })}</div>`
}

export function inline(text: string, fontPx = 30): string {
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
      const close = text.indexOf('`', i + 1)
      if (close !== -1 && close > i + 1) {
        flushText()
        pieces.push({ kind: 'code', value: text.slice(i + 1, close) })
        i = close + 1
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
      if (piece.kind === 'code') return `<code>${escapeHtml(piece.value)}</code>`
      if (piece.kind === 'math') {
        const svg = texToSvg(piece.value, { display: piece.display, fontPx })
        return piece.display ? `<span class="mathblock-inline">${svg}</span>` : svg
      }
      return emphasis(escapeHtml(piece.value))
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

function emphasis(escaped: string): string {
  let out = escaped
  out = out.replace(/\[([^\]]{1,200})\]\(([^)\s]{1,500})\)/g, (m, label, href) => {
    return `<a href="${escapeAttribute(href)}">${label}</a>`
  })
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
