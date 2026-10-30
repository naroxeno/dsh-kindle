/**
 * Math for the Kindle client.
 *
 * Everything is rendered on the host: TeX goes in, a self-contained inline
 * <svg> comes out with pixel geometry (the device UA is WebKit 534, which
 * handles SVG but sizes `ex` badly, so no `ex` survives this module).
 *
 * AsciiMath support: the Kindle composer is typed on a five-way controller, so
 * `$...$` segments are treated as AsciiMath and converted to TeX *before*
 * display and *before* the prompt is sent to the model.
 */
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
/** TeX packages kept deliberately small: startup cost on the host, not the device. */
const TEX_PACKAGES = AllPackages;
const SHARED = Symbol.for('dsh-kindle.math');
const shared = globalThis[SHARED] || (globalThis[SHARED] = {
    doc: null,
    adaptor: null,
    rev: '',
    cache: new Map(),
    amToTex: null,
});
/**
 * A MathJax document costs hundreds of milliseconds to build, and the ESM
 * registry never unloads a ?gen=N URL, so each hot reload would otherwise leak
 * another engine and a fresh (empty, then cold) SVG cache. Both are shared
 * across generations instead. The cache is stamped with a hash of this file:
 * editing the renderer drops SVGs produced by the previous copy of the code.
 */
const REV = createHash('sha256')
    .update(readFileSync(new URL('./math.js', import.meta.url)))
    .digest('hex')
    .slice(0, 12);
if (shared.rev !== REV) {
    shared.rev = REV;
    shared.cache = new Map();
}
const cache = shared.cache;
const CACHE_LIMIT = 3000;
function engine() {
    if (shared.doc)
        return { doc: shared.doc, adaptor: shared.adaptor };
    shared.adaptor = liteAdaptor();
    RegisterHTMLHandler(shared.adaptor);
    const tex = new TeX({ packages: TEX_PACKAGES });
    const svg = new SVG({ fontCache: 'local' });
    shared.doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
    return { doc: shared.doc, adaptor: shared.adaptor };
}
/**
 * MathJax drops `\tag{..}` when only the SVG node is kept, so fold the tag
 * into the formula body: `... \qquad (1)`.
 * @param {string} tex
 */
function flattenTags(tex) {
    return tex
        .replace(/\\tag\*\s*\{([^{}]*)\}/g, (m, body) => '\\qquad\\text{' + body + '}')
        .replace(/\\tag\s*\{([^{}]*)\}/g, (m, body) => '\\qquad\\text{(' + body + ')}');
}
/** 1 TeX `em` is 1000 internal MathJax units. */
const UNITS_PER_EM = 1000;
/**
 * Rewrite MathJax's `ex`-based box geometry to pixels.
 * @param {string} svg raw MathJax SVG markup
 * @param {number} fontPx the CSS font size the formula is displayed at
 */
function toPixels(svg, fontPx) {
    const box = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
    if (!box)
        return svg;
    const top = Number(box[2]);
    const width = Number(box[3]);
    const height = Number(box[4]);
    const pxW = (width * fontPx) / UNITS_PER_EM;
    const pxH = (height * fontPx) / UNITS_PER_EM;
    /** Distance from the baseline to the bottom of the box, in px. */
    const depth = ((height + top) * fontPx) / UNITS_PER_EM;
    let out = svg
        .replace(/\swidth="[^"]*"/, ` width="${pxW.toFixed(1)}px"`)
        .replace(/\sheight="[^"]*"/, ` height="${pxH.toFixed(1)}px"`)
        .replace(/\sstyle="[^"]*"/, ` style="vertical-align:${(-depth).toFixed(1)}px"`);
    return out;
}
/**
 * Render one TeX expression to inline SVG markup.
 * @param {string} tex
 * @param {{display?: boolean, fontPx?: number}} [opts]
 * @returns {string} SVG markup, or escaped source text when TeX fails
 */
export function texToSvg(tex, opts = {}) {
    const display = opts.display === true;
    const fontPx = opts.fontPx || 30;
    const key = `${display ? 'D' : 'I'}|${fontPx}|${tex}`;
    const hit = cache.get(key);
    if (hit !== undefined)
        return hit;
    let out;
    try {
        const { doc: document, adaptor: a } = engine();
        const source = flattenTags(tex);
        const node = document.convert(source, {
            display,
            em: fontPx,
            ex: fontPx / 2,
            containerWidth: 900,
        });
        out = toPixels(a.innerHTML(node), fontPx);
        if (!out || out.indexOf('<svg') === -1 || out.indexOf('merror') !== -1) {
            out = '<span class="matherr">' + escapeHtml(tex) + '</span>';
        }
    }
    catch {
        out = '<span class="matherr">' + escapeHtml(tex) + '</span>';
    }
    if (cache.size >= CACHE_LIMIT)
        cache.clear();
    cache.set(key, out);
    return out;
}
function amToTex(source) {
    if (!shared.amToTex) {
        const mod = require('asciimath-to-latex');
        shared.amToTex = mod.default || mod;
    }
    return shared.amToTex(source);
}
/**
 * Convert one AsciiMath segment to TeX. Unparseable input is passed through
 * unchanged (the user may already have typed LaTeX).
 * @param {string} source
 */
export function asciiToTex(source) {
    const trimmed = source.trim();
    if (!trimmed)
        return source;
    try {
        const tex = amToTex(trimmed);
        if (typeof tex === 'string' && tex.trim())
            return tex;
    }
    catch {
        /* fall through */
    }
    return source;
}
/**
 * Rewrite `$...$` / `$$...$$` AsciiMath segments inside a prompt to TeX.
 * A segment is converted only when the conversion succeeds, so hand-written
 * LaTeX inside dollar signs survives untouched.
 * @param {string} text
 */
export function convertPromptMath(text) {
    return rewriteMath(text, (source) => {
        const tex = asciiToTex(source);
        if (tex === source)
            return null;
        return tex;
    });
}
/**
 * Walk `$...$` / `$$...$$` segments.
 * @param {string} text
 * @param {(source: string, display: boolean) => string | null} onMath
 *   return replacement TeX, or null to keep the original source
 */
export function rewriteMath(text, onMath) {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '\\' && text[i + 1] === '$') {
            out += '$';
            i += 2;
            continue;
        }
        if (ch === '$') {
            const display = text[i + 1] === '$';
            const open = display ? 2 : 1;
            const close = findClose(text, i + open, display ? '$$' : '$');
            if (close === -1) {
                out += text.slice(i);
                break;
            }
            const source = text.slice(i + open, close);
            if (!source.trim() || source.indexOf('\n') !== -1 && !display) {
                out += text.slice(i, close + open);
                i = close + open;
                continue;
            }
            const replaced = onMath(source, display);
            const delim = display ? '$$' : '$';
            out += delim + (replaced === null ? source : replaced) + delim;
            i = close + open;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}
function findClose(text, from, delim) {
    let i = from;
    while (i < text.length) {
        if (text.startsWith(delim, i) && text[i - 1] !== '\\')
            return i;
        i += 1;
    }
    return -1;
}
export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
