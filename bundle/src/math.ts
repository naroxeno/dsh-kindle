import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const TEX_PACKAGES = AllPackages

interface SharedState {
  doc: ReturnType<typeof mathjax.document> | null
  adaptor: ReturnType<typeof liteAdaptor> | null
  rev: string
  cache: Map<string, string>
  amToTex: ((source: string) => string) | null
}

const SHARED: unique symbol = Symbol.for('dsh-kindle.math')
const globals = globalThis as typeof globalThis & { [SHARED]: SharedState | undefined }
const shared: SharedState =
  globals[SHARED] ||
  (globals[SHARED] = {
    doc: null,
    adaptor: null,
    rev: '',
    cache: new Map(),
    amToTex: null,
  })

const REV = createHash('sha256')
  .update(readFileSync(new URL('./math.js', import.meta.url)))
  .digest('hex')
  .slice(0, 12)
if (shared.rev !== REV) {
  shared.rev = REV
  shared.cache = new Map()
}
const cache = shared.cache
const CACHE_LIMIT = 3000

type Engine = { doc: ReturnType<typeof mathjax.document>; adaptor: ReturnType<typeof liteAdaptor> }

function engine(): Engine {
  if (shared.doc) return { doc: shared.doc, adaptor: shared.adaptor }
  shared.adaptor = liteAdaptor()
  RegisterHTMLHandler(shared.adaptor)
  const tex = new TeX({ packages: TEX_PACKAGES })
  const svg = new SVG({ fontCache: 'local' })
  shared.doc = mathjax.document('', { InputJax: tex, OutputJax: svg })
  return { doc: shared.doc, adaptor: shared.adaptor }
}

function flattenTags(tex: string): string {
  return tex
    .replace(/\\tag\*\s*\{([^{}]*)\}/g, (m, body) => '\\qquad\\text{' + body + '}')
    .replace(/\\tag\s*\{([^{}]*)\}/g, (m, body) => '\\qquad\\text{(' + body + ')}')
}

const UNITS_PER_EM = 1000

function toPixels(svg: string, fontPx: number): string {
  const box = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)
  if (!box) return svg
  const top = Number(box[2])
  const width = Number(box[3])
  const height = Number(box[4])
  const pxW = (width * fontPx) / UNITS_PER_EM
  const pxH = (height * fontPx) / UNITS_PER_EM
  const depth = ((height + top) * fontPx) / UNITS_PER_EM
  let out = svg
    .replace(/\swidth="[^"]*"/, ` width="${pxW.toFixed(1)}px"`)
    .replace(/\sheight="[^"]*"/, ` height="${pxH.toFixed(1)}px"`)
    .replace(/\sstyle="[^"]*"/, ` style="vertical-align:${(-depth).toFixed(1)}px"`)
  return out
}

export interface TexToSvgOptions {
  display?: boolean
  fontPx?: number
}

export function texToSvg(tex: string, opts: TexToSvgOptions = {}): string {
  const display = opts.display === true
  const fontPx = opts.fontPx || 30
  const key = `${display ? 'D' : 'I'}|${fontPx}|${tex}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let out: string
  try {
    const { doc: document, adaptor: a } = engine()
    const source = flattenTags(tex)
    const node = document.convert(source, {
      display,
      em: fontPx,
      ex: fontPx / 2,
      containerWidth: 900,
    })
    out = toPixels(a.innerHTML(node), fontPx)
    if (!out || out.indexOf('<svg') === -1 || out.indexOf('merror') !== -1) {
      out = '<span class="matherr">' + escapeHtml(tex) + '</span>'
    }
  } catch {
    out = '<span class="matherr">' + escapeHtml(tex) + '</span>'
  }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, out)
  return out
}

function amToTex(source: string): string {
  if (!shared.amToTex) {
    const mod = require('asciimath-to-latex')
    shared.amToTex = mod.default || mod
  }
  return shared.amToTex(source)
}

export function asciiToTex(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return source
  try {
    const tex = amToTex(trimmed)
    if (typeof tex === 'string' && tex.trim()) return tex
  } catch {}
  return source
}

export function convertPromptMath(text: string): string {
  return rewriteMath(text, (source) => {
    const tex = asciiToTex(source)
    if (tex === source) return null
    return tex
  })
}

export function rewriteMath(
  text: string,
  onMath: (source: string, display: boolean) => string | null,
): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && text[i + 1] === '$') {
      out += '$'
      i += 2
      continue
    }
    if (ch === '$') {
      const display = text[i + 1] === '$'
      const open = display ? 2 : 1
      const close = findClose(text, i + open, display ? '$$' : '$')
      if (close === -1) {
        out += text.slice(i)
        break
      }
      const source = text.slice(i + open, close)
      if (!source.trim() || (source.indexOf('\n') !== -1 && !display)) {
        out += text.slice(i, close + open)
        i = close + open
        continue
      }
      const replaced = onMath(source, display)
      const delim = display ? '$$' : '$'
      out += delim + (replaced === null ? source : replaced) + delim
      i = close + open
      continue
    }
    out += ch
    i += 1
  }
  return out
}

function findClose(text: string, from: number, delim: string): number {
  let i = from
  while (i < text.length) {
    if (text.startsWith(delim, i) && text[i - 1] !== '\\') return i
    i += 1
  }
  return -1
}

export function escapeHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
