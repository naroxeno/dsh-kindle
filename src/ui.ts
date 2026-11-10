const STAMP = new URL(import.meta.url).search
const { escapeHtml, texToSvg, convertPromptMath } = await import('./math.js' + STAMP)
const { renderMarkdown, renderMarkdownDoc, inline } = await import('./markdown.js' + STAMP)
const { priceWindow } = await import('./account.js' + STAMP)

import type { KindleConfig } from './host.js'

export interface UiMessage {
  kind: 'user' | 'assistant' | 'tool'
  text: string
  interrupted?: boolean
  name?: string
  error?: boolean
}

interface ListItem {
  sessionId: string
  title: string
  updatedAt?: number
  running?: boolean
  blank?: boolean
}

interface ShellOptions {
  fontSize?: number
  bodyClass?: string
  /** 2em first-line indent for chat replies (opt-in). */
  indent?: boolean
  /** 2em first-line indent for articles and Markdown files (opt-out). */
  indentArt?: boolean
}

export interface ListExtras {
  balance?: string
  total?: number
  /** Title filter currently applied; the box is refilled from it. */
  query?: string
  /** Name of the workspace the list is scoped to. */
  workspace?: string
}

export interface RenameView {
  sessionId: string
  title?: string
}

export interface DeleteView extends RenameView {
  cwd?: string
}

export interface PreviewView {
  sessionId: string
  draft?: string
}

export interface UiModelChoice {
  name?: string
  efforts: Array<{ id: string; name?: string }>
  current?: string
}

export interface SessionView {
  sessionId: string
  title?: string
  /** Working directory used to resolve relative Markdown links in messages. */
  cwd?: string
  messages: UiMessage[]
  /** Text kept in the reply box after a rejected send or an edit. */
  draft?: string
  running?: boolean
  hasOlder?: boolean
  hasTools?: boolean
  window: number
  cursor?: number
  fresh?: boolean
  updatedAt?: number
  version?: string
  /** Reasoning-effort choices for the composer at the bottom. */
  model?: UiModelChoice | null
}

export type FileKind = 'md' | 'text' | 'image' | 'other'

export interface FileRow {
  path: string
  name: string
  relative: string
  size: number
  updatedAt?: number
  dir?: boolean
  kind?: FileKind
}

export interface FilesView {
  sessionId?: string
  workspace: string
  dir: string
  label: string
  parent?: string
  crumbs: { name: string; path: string }[]
  entries: FileRow[]
  truncated?: boolean
}

export interface FilesPinView {
  next?: string
  error?: string
  wait?: number
  missing?: boolean
  scope?: 'files' | 'settings'
}

export interface TextView {
  path: string
  name: string
  dir: string
  size: number
  updatedAt?: number
  source: string
  from?: string
}

export interface FileView {
  path: string
  name: string
  dir: string
  size: number
  updatedAt?: number
  source: string
  from?: string
  /** Block index of the heading to open at; the Kindle cannot jump to #anchors. */
  at?: number
}

export interface ImageView {
  path: string
  name: string
  dir: string
  size: number
  updatedAt?: number
  from?: string
}

export interface ToolsView {
  sessionId: string
  title?: string
  tools: UiMessage[]
  total?: number
  limit?: number
  updatedAt?: number
}

export interface AccountWallet {
  text: string
}

export interface AccountView {
  ok?: boolean
  reason?: string
  wallets?: AccountWallet[]
  bonuses?: AccountWallet[]
  links?: { usageUrl?: string; topUpUrl?: string }
}

export interface AccountPageView {
  account?: AccountView
}

const PALETTE: Array<[string, string]> = [
  ['分式', '$frac{ }{ }$'],
  ['根号', '$sqrt{ }$'],
  ['平方', '$x^2$'],
  ['下标', '$x_1$'],
  ['积分', '$int_a^b f(x) dx$'],
  ['求和', '$sum_(i=1)^n a_i$'],
  ['极限', '$lim_(x->0) f(x)$'],
  ['无穷', '$oo$'],
  ['π', '$pi$'],
  ['α', '$alpha$'],
  ['θ', '$theta$'],
  ['λ', '$lambda$'],
  ['≤', '$le$'],
  ['≥', '$ge$'],
  ['≠', '$!=$'],
  ['×', '$xx$'],
  ['→', '$->$'],
  ['⇔', '$<=>$'],
]

const SANS =
  '"STHeiti","Heiti SC","PingFang SC","Microsoft YaHei","Droid Sans Fallback","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Zen Hei","FZHei","SimHei",sans-serif'

const STYLE = (fontSize: number): string => `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:${SANS};font-size:${fontSize}px;line-height:1.7;padding-bottom:24px;-webkit-text-size-adjust:100%}
a{color:#000;text-decoration:none;outline:0}
.hei{font-family:${SANS}}
h1,h2,h3,h4{font-weight:bold;margin:0}

.tb{width:100%;border-collapse:collapse;border-bottom:2px solid #ddd}
.tb td{height:96px;padding:0;vertical-align:middle}
.tb .tl{text-align:left;padding-left:12px}
.tb .tr{text-align:right;padding-right:12px}
.tb a{display:inline-block;padding:24px 16px;font-size:0.9em;line-height:1.2;color:#000}
.tb .brand{display:inline-block;padding-left:12px;font-size:0.9em;font-weight:bold;letter-spacing:0.06em}
.tb .tag{display:inline-block;font-size:0.66em;font-weight:bold;letter-spacing:0.12em;padding:8px 12px;border:2px solid #000;margin-right:14px;vertical-align:middle}
.tb .tag.peak{background:#000;color:#fff}

.hd{padding:8px 24px 18px;border-bottom:2px solid #000}
.hd h1{font-size:1.16em;line-height:1.35;word-wrap:break-word}
.hd .sub{margin:8px 0 0;font-size:0.82em;color:#555}

.row{display:block;border-bottom:2px solid #ddd;color:#000}
.row table{width:100%;height:100%;border-collapse:collapse}
.row td{padding:14px 0;vertical-align:middle}
.row td.t{padding-left:24px;padding-right:12px}
.row td.g{width:64px;text-align:center;font-size:1.25em;color:#777}
.row .ttl{font-size:1em;font-weight:bold;line-height:1.32;word-wrap:break-word}
.row .meta{margin:5px 0 0;font-size:0.78em;color:#555}
.row .meta .n{margin-right:14px}
.row:active{background:#eaeaea}
.row.dim .ttl{color:#666}
.grp{padding:16px 24px 6px;font-size:0.76em;letter-spacing:0.1em;color:#555}
.bc{padding:16px 24px;border-bottom:2px solid #ddd;background:#f1f1f1;font-size:0.86em;color:#555;line-height:1.5}
.bc a{text-decoration:underline}
.plain{margin:0;white-space:pre-wrap;word-wrap:break-word;font-size:0.94em;line-height:1.55}
.flag{display:inline-block;border:0;background:none;color:#000;padding:0;font-size:1em;line-height:1.35}
.flag.off{color:#666}

.strip{width:100%;border-collapse:collapse;table-layout:fixed;border-bottom:2px solid #ddd}
.strip td{padding:0;border-left:2px solid #ddd}
.strip td:first-child{border-left:0}
.cell{display:block;width:100%;height:96px;line-height:96px;padding:0;border:0;background:#fff;color:#000;text-align:center;font-size:0.88em;text-decoration:none}
.cell:active{background:#e8e8e8}

.mode{display:block;width:100%;text-align:left;padding:22px 24px;margin:0 0 18px;border:3px solid #000;background:#fff;color:#000;font:inherit}
.mode:active{background:#dcdcdc}
.mode.on{border-width:6px}
.mode .n{display:block;font-family:serif;font-size:1.02em;font-weight:bold;line-height:1.4}
.mode .d{display:block;margin-top:10px;font-size:0.8em;line-height:1.5;color:#444;word-wrap:break-word}
.mode .badge{font-size:0.72em;font-weight:normal;color:#555;border:1px solid #999;padding:1px 6px;margin-left:8px}
.mode[disabled]{opacity:0.45}
.wrow{width:100%;border-collapse:collapse;margin:0 0 18px}
.wrow td{padding:0;vertical-align:middle}
.wrow td.h{width:150px;padding-left:12px}
.wrow .mode{margin:0}
.hbtn{display:block;width:100%;height:104px;line-height:98px;padding:0;border:3px solid #000;background:#fff;color:#000;font:inherit;font-size:0.82em}
.hbtn:active{background:#dcdcdc}

.lbl{margin:0 0 10px;font-size:0.82em;letter-spacing:0.06em;color:#555}
.sb{padding:0 24px 16px}
.sbar{width:100%;border-collapse:collapse;table-layout:fixed}
.sbar td{padding:0;vertical-align:middle}
.sbar td.b{width:120px;padding-left:12px}
.sbar td.n{width:176px;padding-left:12px}
.sbar input{height:92px;font-size:0.92em}
.sgo{display:block;width:100%;height:92px;line-height:86px;margin:0;padding:0;border:3px solid #000;background:#fff;color:#000;font:inherit;font-size:0.88em}
.sgo:active{background:#dcdcdc}
.hits{margin:14px 0 0;font-size:0.82em;color:#555}
.hits a{text-decoration:underline}
.alert.err{background:#fff;color:#000;border:3px solid #000}
.modelbar{padding:18px 24px 20px;border-bottom:2px solid #ddd}
.seg{width:100%;border-collapse:collapse;table-layout:fixed;border:2px solid #000}
.seg td{padding:0;border-left:2px solid #000}
.seg td:first-child{border-left:0}
.mini{display:block;width:100%;height:92px;line-height:92px;padding:0;border:0;background:#fff;color:#000;font-size:0.9em}
.mini.on{background:#000;color:#fff}

.pad{padding:24px}
.sect{padding:26px 0 12px;font-size:0.82em;letter-spacing:0.1em;color:#555}
.hint{margin:14px 0 0;font-size:0.86em;line-height:1.6;color:#555}
.alert{background:#000;color:#fff;padding:22px 24px;font-size:0.9em;line-height:1.5;margin:0 0 24px}
.empty{padding:56px 24px;text-align:center}
.empty .t{margin:0 0 12px;font-size:1.04em}
.value{font-size:1.45em;font-weight:bold;line-height:1.3}

.btn{display:block;width:100%;height:104px;line-height:98px;margin:0;padding:0;border:3px solid #000;background:#fff;color:#000;font-size:0.94em;text-align:center;text-decoration:none}
button.btn{line-height:98px}
.btn:active{background:#dcdcdc}
.btn.primary{background:#000;color:#fff}
.btn.primary:active{background:#333}
.stack .btn{margin-top:16px}

textarea{display:block;width:100%;min-height:9em;padding:18px;border:3px solid #000;background:#fff;color:#000;font-size:1em;line-height:1.6}
input[type=text],input[type=password]{display:block;width:100%;height:104px;padding:0 18px;border:3px solid #000;background:#fff;color:#000;font-size:1em}

.msg{padding:22px 24px 24px;border-bottom:2px solid #ddd;border-left:10px solid #fff}
.msg.u{background:#f1f1f1;border-left-color:#000}
.msg .who{margin:0 0 14px;font-size:0.82em;letter-spacing:0.12em;color:#555}
.msg.u .who{color:#000;font-weight:bold}
.msg .body{overflow:hidden}
.msg .body > *:first-child{margin-top:0}
.msg .body > *:last-child{margin-bottom:0}
.msg .body p{margin:16px 0}
/* Chinese reading habit: a two-character first-line indent. Chats opt in,
   articles and Markdown files opt out. */
body.ind .msg .body p{text-indent:2em}
body.indart .msg .body p{text-indent:2em}
.toc a{display:block;padding:16px 0;border-bottom:1px solid #000;color:#000;text-decoration:underline}
.toc a.lv2{padding-left:32px;font-size:0.94em}
.toc a.lv3{padding-left:64px;font-size:0.9em;color:#333}
.fig{margin:16px 0;text-align:center}
.fig img{max-width:100%;height:auto;border:1px solid #000}
.shot{margin:16px 0;text-align:center}
.shot img{max-width:100%;height:auto}
.msg .body h2,.msg .body h3,.msg .body h4{font-size:1.04em;line-height:1.4;margin:28px 0 12px}
.msg .body ul,.msg .body ol{margin:16px 0;padding-left:40px}
.msg .body li{margin:8px 0}
.msg .body hr{border:0;border-top:3px solid #ccc;margin:28px 0}
.msg .body blockquote{margin:20px 0;padding-left:18px;border-left:8px solid #ddd;color:#333}
.msg .body table{border-collapse:collapse;margin:20px 0;font-size:0.84em;max-width:100%}
.msg .body td,.msg .body th{border:2px solid #999;padding:8px 10px;vertical-align:top;word-wrap:break-word}
.msg .body th{background:#eee;text-align:left;white-space:nowrap}
.msg .body pre.code{font-family:monospace;font-size:0.74em;line-height:1.55;background:#f5f5f5;border:2px solid #ccc;padding:14px;white-space:pre-wrap;word-wrap:break-word;margin:20px 0}
.msg .body code{font-family:monospace;font-size:0.9em;background:#eee;padding:1px 5px}
.msg .body a{text-decoration:underline}

.msg.tools{background:#f6f6f6;border-left-color:#bbb}
.msg.tools .who{font-size:0.8em}
.toolsum{display:block;padding:6px 0;font-family:monospace;font-size:0.78em;color:#444;text-decoration:none}
.toolsum:after{content:""}
.toolrow{margin:14px 0}
.toolname{margin-bottom:6px;font-family:monospace;font-size:0.76em;color:#333}
.toolbody{font-family:monospace;font-size:0.72em;line-height:1.55;color:#555;white-space:pre-wrap;word-wrap:break-word}
.toolbody.err{color:#8a0000}

.st{padding:20px 24px;background:#f1f1f1;font-size:0.86em}
.older{display:block;padding:24px 0;border-bottom:2px solid #ddd;text-align:center;font-size:0.86em}
.older:active{background:#eaeaea}

.mathblock{text-align:center;margin:22px 0;overflow:hidden}
svg{max-width:100%}
figure.fig{margin:26px 0;padding:0;text-align:center}
figure.fig svg{max-width:100%;height:auto}
figure.fig img{max-width:100%;height:auto}
figure.fig figcaption{margin-top:10px;font-size:0.74em;color:#444}
.figmiss{font-family:monospace;font-size:0.72em;color:#555}
.matherr{font-family:monospace;font-size:0.72em;background:#f4f4f4;border:2px dotted #888;padding:4px 8px;word-wrap:break-word}

.composer{margin-top:40px;padding:0 24px 8px;border-top:3px solid #000}
.palette{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
.palette td{padding:5px}
.palette button{display:block;width:100%;height:92px;padding:0;border:2px solid #000;background:#fff;color:#000;font-size:0.86em;line-height:1.15}
.palette button:active{background:#e8e8e8}

.newbtn{display:block;height:92px;line-height:86px;margin:0;border:3px solid #000;background:#000;color:#fff;text-align:center;text-decoration:none;font-size:0.88em}
.newbtn:active{background:#333}
.stbtn{display:block;width:100%;height:84px;padding:0;border:0;border-bottom:2px solid #000;background:#f1f1f1;color:#000;text-align:center;font:inherit;font-size:0.86em}
.stbtn:active{background:#d0d0d0}
.pin{height:132px;font-size:2em;letter-spacing:.32em;text-align:center;padding-left:.32em}
`

function shell(title: string, body: string, opts: ShellOptions = {}): string {
  const fontSize = opts.fontSize || 30
  const classes = [opts.bodyClass || '', opts.indent ? 'ind' : '', opts.indentArt ? 'indart' : '']
    .filter(Boolean)
    .join(' ')
  const bodyClass = classes ? ` class="${classes}"` : ''
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE(fontSize)}</style>
</head><body${bodyClass}>
${body}
</body></html>`
}

function toolBar(left: string, right: string): string {
  // Pages without actions in the right cell (login, error) skip the badge too.
  const tag = right ? priceBadge() : ''
  return `<table class="tb"><tr><td class="tl">${left}</td><td class="tr">${tag}${right}</td></tr></table>`
}

/** The DeepSeek price window right now: peak doubles, idle halves. */
function priceBadge(): string {
  let win: { peak: boolean; label: string }
  try {
    win = priceWindow()
  } catch (error) {
    return ''
  }
  if (!win.label) return ''
  return `<span class="tag${win.peak ? ' peak' : ''}">${escapeHtml(win.label)}</span>`
}

function pageHead(title: string, sub?: string): string {
  return `<div class="hd"><h1>${escapeHtml(title)}</h1>${sub ? `<p class="sub">${escapeHtml(sub)}</p>` : ''}</div>`
}

function paletteTable(): string {
  const rows: string[] = []
  for (let i = 0; i < PALETTE.length; i += 4) {
    const cells = PALETTE.slice(i, i + 4)
      .map(([label, snippet]) => {
        const call = escapeHtml(JSON.stringify(snippet))
        return `<td><button type="button" onclick="ins(${call})">${escapeHtml(label)}</button></td>`
      })
      .join('')
    rows.push(`<tr>${cells}</tr>`)
  }
  return `<table class="palette">${rows.join('')}</table>`
}

function composerScript(extra: string): string {
  return `
var ta=document.getElementById('msg');
function ins(s){
  var a=ta.value,b=ta.selectionStart,c=ta.selectionEnd,d='';
  if(typeof b==='number'&&typeof c==='number'){d=a.substring(0,b)+s+a.substring(c);}
  else{d=a+s;}
  ta.value=d;
  try{ta.focus();if(typeof b==='number'){ta.selectionStart=ta.selectionEnd=b+s.length;}}catch(e){}
}
function doPreview(){document.getElementById('preview-msg').value=ta.value;document.getElementById('preview-form').submit();return false;}
${extra}`
}

export function renderLogin(
  config: KindleConfig,
  next?: string,
  options?: { error?: boolean },
): string {
  const failed = Boolean(options && options.error)
  const body = `
${toolBar('<span class="brand">DSH · Kindle</span>', '')}
${pageHead('需要访问令牌')}
<div class="pad">
${failed ? '<div class="alert">令牌不对，再试一次。</div>' : ''}
<form method="post" action="/login">
  <input type="hidden" name="next" value="${escapeHtml(next || '/s')}">
  <div class="lbl">令牌</div>
  <input type="password" name="token" autocomplete="off">
  <p class="hint">在 Kindle 上输入你在电脑端配置的 token。</p>
  <div class="stack"><button type="submit" class="btn primary">进入</button></div>
</form>
<p class="hint">省事的做法：在电脑上打开日志里打印的登录链接（带 ?t=…），把它抄成 Kindle 的地址打开一次，之后就不用再输令牌了。</p>
</div>`
  return shell('登录', body, { fontSize: config.fontSize, indent: config.indent })
}

export function renderFilesPin(config: KindleConfig, view: FilesPinView = {}): string {
  const settingsScope = view.scope === 'settings'
  const title = settingsScope ? '隐藏工作区' : '文件密码'
  const message = view.missing
    ? (settingsScope ? '密码' : '文件密码') + '还没有设置，先让管理员配置 .kindle-files-pin。'
    : view.wait
      ? '尝试次数太多，请 ' + view.wait + ' 秒后再试。'
      : view.error || ''
  const form = view.missing
    ? ''
    : `<form method="post" action="/files/unlock">
  <input type="hidden" name="next" value="${escapeHtml(view.next || '/files')}">
  <div class="lbl">密码</div>
  <input class="pin" type="text" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off">
  <p class="hint">六位数字。${settingsScope ? '隐藏的工作区也走这一道' : '文件列表、正文和图片都走这一道'}；解锁后 1 小时有效，过期重新输入。</p>
  <div class="stack"><button type="submit" class="btn primary">解锁</button></div>
</form>`
  const body = `
${toolBar('<a href="/s">‹ 会话</a>', '')}
${pageHead(title, view.missing ? '' : '6 位数字，1 小时内有效')}
<div class="pad">
${message ? '<div class="alert err">' + escapeHtml(message) + '</div>' : ''}
${form}
</div>`
  return shell(title, body, { fontSize: config.fontSize, indent: config.indent })
}

export function renderError(config: KindleConfig, status: number, message: string): string {
  const body = `
${toolBar('<a href="/s">‹ 列表</a>', '')}
${pageHead('出错了')}
<div class="pad">
<p class="value">${status}</p>
<p class="hint">${escapeHtml(message)}</p>
<div class="stack"><a class="btn" href="/s">返回会话列表</a></div>
</div>`
  return shell('出错了', body, { fontSize: config.fontSize, indent: config.indent })
}

export function renderList(
  config: KindleConfig,
  sessions: ListItem[],
  notice?: string,
  extras: ListExtras = {},
): string {
  const rowHtml = (s: ListItem): string => {
    const id = escapeHtml(s.sessionId)
    const flags = [
      s.running ? '<span class="flag">● 生成中</span>' : '',
      s.blank ? '<span class="flag off">● 空会话</span>' : '',
    ]
      .filter(Boolean)
      .join(' ')
    const meta = [formatWhen(s.updatedAt), flags].filter(Boolean).join(' ')
    return (
      '<a class="row" href="/c/' +
      id +
      '"><table><tr><td class="t"><div class="ttl">' +
      escapeHtml(s.title) +
      '</div><div class="meta">' +
      meta +
      '</div></td><td class="g">›</td></tr></table></a>'
    )
  }

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const dayMs = dayStart.getTime()
  const weekStart = new Date(
    dayStart.getFullYear(),
    dayStart.getMonth(),
    dayStart.getDate() - ((dayStart.getDay() + 6) % 7),
  )
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1)
  const weekMs = weekStart.getTime()
  const monthMs = monthStart.getTime()
  const buckets: ListItem[][] = [[], [], [], []]
  for (const s of sessions) {
    const t = Number(s.updatedAt) || 0
    buckets[t >= dayMs ? 0 : t >= weekMs ? 1 : t >= monthMs ? 2 : 3].push(s)
  }
  const labels = ['今天', '本周', '本月', '更早']
  const section = (label: string, items: ListItem[]): string =>
    '<div class="grp">' + label + '</div>' + items.map(rowHtml).join('')
  const groups = buckets.map((items, i) => (items.length ? section(labels[i], items) : '')).join('')

  const rows = sessions.length
    ? buckets.filter((items) => items.length > 0).length > 1
      ? groups
      : sessions.map(rowHtml).join('')
    : extras.query
      ? '<div class="empty"><p class="t">没有匹配的会话</p><p class="hint">换个词，或者清掉搜索。</p></div>'
      : '<div class="empty"><p class="t">这里还没有会话</p><p class="hint">点上面的「＋ 新会话」开一个。</p></div>'

  // The balance lives in the top bar: it is one short wallet line, and the
  // scroll area is worth more to a session row on an e-ink screen.
  const balance = extras.balance ? '<a href="/me">' + escapeHtml(extras.balance) + '</a>' : ''
  const query = extras.query || ''
  const total = extras.total === undefined ? sessions.length : extras.total
  const sub = [extras.workspace || '', total ? '共 ' + total + ' 个' : '']
    .filter(Boolean)
    .join(' · ')
  const hits = query ? '<p class="hits">找到 ' + total + ' 个 · <a href="/s">清除搜索</a></p>' : ''

  const body = `
<div id="head">
${toolBar('<span class="brand">DSH · Kindle</span>', `${balance}<a href="/settings">设置</a><a href="/s">刷新</a>`)}
${pageHead('会话', sub)}
${notice ? `<div class="alert">${escapeHtml(notice)}</div>` : ''}
<div class="sb"><form method="post" action="/s"><table class="sbar"><tr><td class="f"><input type="text" name="q" value="${escapeHtml(query)}" placeholder="搜索标题" autocomplete="off"></td><td class="b"><button type="submit" class="sgo">搜索</button></td><td class="n"><a class="newbtn" href="/new">＋ 新会话</a></td></tr></table></form>${hits}</div>
</div>
<div id="scroll">${rows}</div>`
  return shell('DSH Kindle', body, { fontSize: config.fontSize, indent: config.indent })
}

export function renderRename(config: KindleConfig, view: RenameView): string {
  const id = escapeHtml(view.sessionId)
  const body = `
${toolBar(`<a href="/c/${id}">‹ 返回会话</a>`, '')}
${pageHead('改名')}
<div class="pad">
<form method="post" action="/c/${id}/rename">
  <div class="lbl">会话标题</div>
  <input type="text" name="title" value="${escapeHtml(view.title || '')}" autocomplete="off">
  <p class="hint">留空会由模型自动生成标题。改名只影响显示。</p>
  <div class="stack">
    <button type="submit" class="btn primary">保存</button>
    <a class="btn" href="/c/${id}">取消</a>
  </div>
</form>
</div>`
  return shell('改名', body, { fontSize: config.fontSize, indent: config.indent })
}

export interface NewSessionOption {
  id: string
  name: string
  description: string
  broken: string
}

export interface NewSessionView {
  options: NewSessionOption[]
  defaultId: string
}

export function renderNewSession(config: KindleConfig, view: NewSessionView): string {
  const cells = view.options.length
    ? view.options
        .map((option) => {
          const badge = option.id === view.defaultId ? '<span class="badge">默认</span>' : ''
          const detail = option.broken
            ? `<span class="d">暂不可用：${escapeHtml(option.broken)}</span>`
            : option.description
              ? `<span class="d">${escapeHtml(option.description)}</span>`
              : ''
          return `<form method="post" action="/new"><input type="hidden" name="preset" value="${escapeHtml(option.id)}"><button type="submit" class="mode"${option.broken ? ' disabled' : ''}><span class="n">${escapeHtml(option.name)}${badge}</span>${detail}</button></form>`
        })
        .join('')
    : `<form method="post" action="/new"><button type="submit" class="btn primary">新建会话</button></form>`

  const hint = view.options.length
    ? '<p class="hint">模式决定这个会话带哪些能力，开了以后不能换。</p>'
    : '<p class="hint">这套部署只配了一种模式。</p>'

  const body = `
${toolBar('<a href="/s">‹ 列表</a>', '')}
${pageHead('新会话', view.options.length > 1 ? '选一个模式' : '')}
<div class="pad">
${hint}
${cells}
</div>`
  return shell('新会话', body, { fontSize: config.fontSize, indent: config.indent })
}

export function renderDelete(config: KindleConfig, view: DeleteView): string {
  const id = escapeHtml(view.sessionId)
  const body = `
${toolBar(`<a href="/c/${id}">‹ 返回会话</a>`, '')}
${pageHead('删除这个会话？')}
<div class="pad">
  <div class="lbl">会话</div>
  <div class="value">${escapeHtml(view.title || '（未命名会话）')}</div>
  <p class="hint">会话会从 Kindle 列表里移除，文件仍保留在 ${escapeHtml(view.cwd || '')} 下，电脑端可以找回。正在生成的会话要先停止。</p>
  <form method="post" action="/c/${id}/delete">
    <div class="stack">
      <button type="submit" class="btn primary">删除</button>
      <a class="btn" href="/c/${id}">取消</a>
    </div>
  </form>
</div>`
  return shell('删除会话', body, { fontSize: config.fontSize, indent: config.indent })
}

const EFFORT_LABELS: Record<string, string> = {
  off: '关',
  low: '低',
  medium: '中',
  high: '高',
  max: '最大',
}

function modelBar(view: { sessionId: string; model?: UiModelChoice | null }): string {
  const model = view.model
  if (!model || !Array.isArray(model.efforts) || model.efforts.length < 2) return ''
  const action = `/c/${escapeHtml(view.sessionId)}/effort`
  const choices = model.efforts.map((effort) => ({
    id: effort.id,
    label: EFFORT_LABELS[effort.id] || effort.name || effort.id,
  }))
  if (model.current && !choices.some((choice) => choice.id === model.current)) {
    choices.push({ id: model.current, label: EFFORT_LABELS[model.current] || model.current })
  }
  const cells = choices
    .map((choice) => {
      const label = escapeHtml(choice.label)
      const button =
        choice.id === model.current
          ? `<button type="button" class="mini on" disabled>${label}</button>`
          : `<button type="submit" name="effort" value="${escapeHtml(choice.id)}" class="mini">${label}</button>`
      return `<td><form method="post" action="${action}">${button}</form></td>`
    })
    .join('')
  const title = model.name ? ` title="${escapeHtml(model.name)}"` : ''
  return `<div class="modelbar"${title}><div class="lbl">思考强度</div><table class="seg"><tr>${cells}</tr></table></div>`
}

export function renderAccount(config: KindleConfig, view: AccountPageView): string {
  const account = view.account || {}
  const links = account.links || {}
  const out: string[] = [
    toolBar('<a href="/s">‹ 列表</a>', '<a href="/me">刷新</a>'),
    pageHead('账户'),
    '<div class="pad">',
  ]

  if (account.ok) {
    for (const wallet of account.wallets || []) {
      out.push('<div class="lbl">余额</div>')
      out.push(`<div class="value">${escapeHtml(wallet.text)}</div>`)
    }
    const bonus = (account.bonuses || [])
      .map((wallet) => String(wallet.text || '').trim())
      .map((text) => ({ text, value: Number(text.replace(/[¥￥,\s]/g, '')) }))
      .filter((entry) => entry.text && entry.value > 0)
      .map((entry) => entry.text)
    if (bonus.length) {
      out.push('<p class="hint">另有赠送 ' + escapeHtml(bonus.join(' / ')) + '（不计入余额）</p>')
    }
  } else if (account.reason === 'no-service') {
    out.push('<p>这个 Host 没有挂载账户服务，读不到余额。</p>')
  } else if (account.reason === 'signed-out') {
    out.push('<p>还没有登录 DeepSeek 平台账号，所以没有余额可读。</p>')
  } else {
    out.push('<p>余额暂时读不到（网络或登录状态）。</p>')
  }
  out.push('</div>')

  const usage = links.usageUrl
    ? `<a class="row" href="${escapeHtml(links.usageUrl)}"><table><tr><td class="t"><div class="ttl">查看用量</div></td><td class="g">›</td></tr></table></a>`
    : ''
  const topUp = links.topUpUrl
    ? `<a class="row" href="${escapeHtml(links.topUpUrl)}"><table><tr><td class="t"><div class="ttl">去充值</div></td><td class="g">›</td></tr></table></a>`
    : ''
  out.push(usage, topUp)
  return shell('账户', out.join(''), { fontSize: config.fontSize, indent: config.indent })
}

export interface SettingsNotice {
  text: string
  error?: boolean
}

export interface SettingsChoice {
  id: string
  path: string
  title: string
  current?: boolean
  hidden?: boolean
}

export interface SettingsView {
  path: string
  title: string
  registered: boolean
  registryReady: boolean
  choices: SettingsChoice[]
  query?: string
  reveal?: boolean
  hiddenCount?: number
  ungrouped: number
  indent?: boolean
  indentArt?: boolean
  notice?: SettingsNotice
  settingsFile?: string
}

/**
 * The two things the Kindle UI owns: which directory new sessions land in, and
 * whether the sessions already sitting there are grouped in the GUI.
 */
export function renderSettings(config: KindleConfig, view: SettingsView): string {
  const notice = view.notice
    ? `<div class="alert${view.notice.error ? ' err' : ''}">${escapeHtml(view.notice.text)}</div>`
    : ''

  const query = view.query || ''
  const hits = query
    ? '<p class="hits">筛出 ' + view.choices.length + ' 个 · <a href="/settings">清除</a></p>'
    : ''
  const search =
    view.choices.length >= 6 || query
      ? '<div class="sb"><form method="post" action="/settings"><input type="hidden" name="action" value="filter">' +
        (view.reveal ? '<input type="hidden" name="view" value="hidden">' : '') +
        '<table class="sbar"><tr><td class="f"><input type="text" name="q" value="' +
        escapeHtml(query) +
        '" placeholder="筛选工作区" autocomplete="off"></td><td class="b"><button type="submit" class="sgo">筛选</button></td></tr></table></form>' +
        hits +
        '</div>'
      : ''

  const choiceRow = (choice: SettingsChoice): string => {
    const carry = view.reveal ? '<input type="hidden" name="view" value="hidden">' : ''
    const card = `<button type="submit" name="action" value="save" class="mode${choice.current ? ' on' : ''}"><span class="n">${escapeHtml(choice.title)}${choice.current ? '<span class="badge">当前</span>' : ''}</span><span class="d">${escapeHtml(choice.path)}</span></button>`
    const toggle = choice.current
      ? ''
      : `<button type="submit" name="action" value="${choice.hidden ? 'unhide' : 'hide'}" class="hbtn">${choice.hidden ? '取消隐藏' : '隐藏'}</button>`
    return `<form method="post" action="/settings"><input type="hidden" name="path" value="${escapeHtml(choice.path)}">${carry}<table class="wrow"><tr><td>${card}</td><td class="h">${toggle}</td></tr></table></form>`
  }
  const visible = view.choices.filter((choice) => !choice.hidden)
  const hiddenChoices = view.choices.filter((choice) => choice.hidden)
  const choices = visible.length
    ? visible.map(choiceRow).join('')
    : query
      ? '<p class="hint">没有匹配的工作区，换个词或者清掉筛选。</p>'
      : view.hiddenCount
        ? '<p class="hint">工作区都藏起来了。</p>'
        : '<p class="hint">这个 Host 还没有注册过工作区。</p>'

  const hiddenBox = view.reveal
    ? '<div class="sect">已隐藏</div>' +
      (hiddenChoices.length
        ? hiddenChoices.map(choiceRow).join('') +
          '<p class="hint"><a href="/settings">收起这些工作区</a></p>'
        : '<p class="hint">' +
          (view.hiddenCount ? '筛选条件下没有隐藏的工作区。' : '没有隐藏的工作区。') +
          ' <a href="/settings">收起</a></p>')
    : view.hiddenCount
      ? '<div class="sect">已隐藏</div><p class="hint">有 ' +
        view.hiddenCount +
        ' 个工作区藏起来了，列表里不显示。</p><a class="btn" href="/settings?hidden=1">输入密码查看</a>'
      : ''

  const adopt = view.ungrouped
    ? `<form method="post" action="/settings"><input type="hidden" name="action" value="adopt"><button type="submit" class="btn">把 ${view.ungrouped} 个旧会话归组</button></form><p class="hint">只动当前目录里的会话，别的组不受影响。</p>`
    : '<p class="hint">当前工作区里的会话都已经归组了。</p>'

  const registry = view.registryReady
    ? ''
    : '<p class="hint">这个 Host 没有挂载 workspace 服务：新会话会按目录建立，但不会出现在 GUI 的分组里。</p>'

  const file = view.settingsFile
    ? `<p class="hint">设置存在 ${escapeHtml(view.settingsFile)}</p>`
    : ''

  // Reading preferences: chat replies keep the flush left margin by default,
  // articles and Markdown files start indented unless told otherwise.
  const row = (
    target: string,
    label: string,
    on: boolean,
  ): string => `<div class="lbl">${label}</div>
<form method="post" action="/settings">
<input type="hidden" name="action" value="indent">
<input type="hidden" name="target" value="${target}">
<table class="seg"><tr>
<td><button type="submit" name="value" value="off" class="mini${on ? '' : ' on'}"${on ? '' : ' disabled'}>不缩进</button></td>
<td><button type="submit" name="value" value="on" class="mini${on ? ' on' : ''}"${on ? ' disabled' : ''}>缩进 2em</button></td>
</tr></table>
</form>`
  const indent = `<div class="sect">排版</div>
${row('chat', '会话正文', Boolean(view.indent))}
${row('file', '文章与文件', Boolean(view.indentArt))}
<p class="hint">只作用于正文段落；标题、列表、代码、表格不受影响。</p>`

  const body = `
${toolBar('<a href="/s">‹ 会话</a>', '<a href="/settings' + (view.reveal ? '?hidden=1' : '') + '">刷新</a>')}
${pageHead('设置', '默认工作区')}
<div class="pad">
${notice}
<div class="sect">当前</div>
<p class="value">${escapeHtml(view.title)}</p>
<p class="hint">${escapeHtml(view.path)}${view.registered ? ' · 已注册' : ' · 还没注册'}</p>
${registry}
${indent}
<div class="sect">换成已有工作区</div>
${search}
${choices}
${hiddenBox}
<div class="sect">其他目录</div>
<form method="post" action="/settings">
<input type="hidden" name="action" value="save">
<div class="lbl">目录路径</div>
<input type="text" name="path" value="${escapeHtml(view.path)}" autocomplete="off">
<p class="hint">填一个已经存在的目录，也可以写 ~/xxx。保存后 Kindle 新建的会话都归到这个工作区。</p>
<div class="stack"><button type="submit" class="btn primary">保存</button></div>
</form>
<div class="sect">旧会话</div>
${adopt}
${file}
</div>`
  return shell('设置', body, { fontSize: config.fontSize, indent: config.indent })
}

export function renderMessages(
  config: KindleConfig,
  messages: UiMessage[],
  toolsHref?: string,
  link: { cwd?: string; from?: string } = {},
): string {
  const fontPx = config.fontSize
  const parts: string[] = []
  let tools: UiMessage[] = []

  function flushTools() {
    if (!tools.length) return
    if (toolsHref) {
      const failed = tools.filter((tool) => tool.error).length
      const label = `⚙ 工具 · ${tools.length} 次${failed ? ' · ' + failed + ' 失败' : ''}`
      parts.push(
        `<div class="msg tools"><a class="toolsum" href="${escapeHtml(toolsHref)}">${label} ›</a></div>`,
      )
      tools = []
      return
    }
    const rows = tools
      .map((tool) => {
        const snippet = tool.text.length > 160 ? tool.text.slice(0, 160) + ' …' : tool.text
        return `<div class="toolrow"><div class="toolname">⚙ ${escapeHtml(tool.name)}${tool.error ? ' · 失败' : ''}</div><div class="toolbody${tool.error ? ' err' : ''}">${escapeHtml(snippet)}</div></div>`
      })
      .join('')
    parts.push(
      `<div class="msg tools"><div class="who">工具 · ${tools.length} 次</div>${rows}</div>`,
    )
    tools = []
  }

  for (const message of messages) {
    if (message.kind === 'tool') {
      if (message.text) tools.push(message)
      continue
    }
    flushTools()
    if (message.kind === 'user') {
      parts.push(
        `<div class="msg u"><div class="who">你</div><div class="body">${inline(message.text, fontPx, link)}</div></div>`,
      )
    } else if (message.kind === 'assistant') {
      const tail = message.interrupted ? '<p class="hint">（已中断）</p>' : ''
      parts.push(
        `<div class="msg a"><div class="who">DSH</div><div class="body">${renderMarkdown(message.text, { fontPx, ...link })}${tail}</div></div>`,
      )
    }
  }
  flushTools()
  return parts.join('') || '<p class="hint">还没有内容。</p>'
}

export function renderTools(config: KindleConfig, view: ToolsView): string {
  const id = escapeHtml(view.sessionId)
  const count = view.tools.length
  const total = Number(view.total) || count
  const sub =
    (total > count ? `最近 ${count} / 共 ${total} 条` : `${count} 条`) +
    (formatTime(view.updatedAt) ? ' · 更新于 ' + formatTime(view.updatedAt) : '')
  const rows = view.tools
    .map((tool) => {
      const body = tool.text.length > 1600 ? tool.text.slice(0, 1600) + ' …' : tool.text
      return `<div class="toolrow"><div class="toolname">⚙ ${escapeHtml(tool.name || 'tool')}${tool.error ? ' · 失败' : ''}</div><div class="toolbody${tool.error ? ' err' : ''}">${escapeHtml(body)}</div></div>`
    })
    .join('')
  const page = `
${toolBar(`<a href="/c/${id}">‹ 会话</a>`, `<a href="/c/${id}/tools">刷新</a>`)}
${pageHead('工具调用', sub)}
<div class="msg tools">${rows || '<p class="hint">这段会话还没有工具调用。</p>'}</div>`
  return shell('工具调用', page, { fontSize: config.fontSize, indent: config.indent })
}

export function renderSession(config: KindleConfig, view: SessionView): string {
  const id = escapeHtml(view.sessionId)
  const older = view.hasOlder
    ? '<a class="older" href="/c/' +
      id +
      '?n=' +
      (view.window + config.pageSize) +
      '">↑ 更早的消息</a>'
    : ''
  const stop = view.running ? '' : ' style="display:none"'

  const body = `
${toolBar(`<a href="/s">‹ 列表</a>`, `<a href="/c/${id}?n=${view.window}">刷新</a>`)}
${pageHead(view.title || '会话', formatTime(view.updatedAt) ? `更新于 ${formatTime(view.updatedAt)}` : '')}
<table class="strip"><tr>
  <td><a class="cell" href="/files?s=${escapeHtml(view.sessionId)}">文件</a></td>
  <td><form method="post" action="/c/${id}/fork"><button type="submit" class="cell">分叉</button></form></td>
  <td><a class="cell" href="/c/${id}/rename">改名</a></td>
  <td><a class="cell" href="/c/${id}/delete">删除</a></td>
</tr></table>
<div class="st" id="state"${view.running ? '' : ' style="display:none"'}>${view.running ? '生成中 · 新内容自动追加' : ''}</div>
<form id="stopbtn" method="post" action="/c/${id}/stop"${stop}><button type="submit" class="stbtn">■ 停止生成</button></form>
${older}
<div id="msgs">${renderMessages(
    config,
    view.messages,
    view.hasTools ? `/c/${id}/tools` : undefined,
    {
      cwd: view.cwd,
      from: '/c/' + encodeURIComponent(view.sessionId),
    },
  )}</div>
<div class="composer" id="composer">
  <div class="sect">输入</div>
  <p class="hint">公式用 $…$ 包起来，用 AsciiMath 语法（例：$sqrt(x^2+y^2)$、$int_0^1 f(x) dx$）。</p>
  <form method="post" action="/c/${id}/send">
    <textarea id="msg" name="msg" rows="6">${escapeHtml(view.draft || '')}</textarea>
    <div class="stack">
      <button type="submit" class="btn primary">发送</button>
      <button type="button" class="btn" onclick="return doPreview()">预览公式</button>
    </div>
  </form>
  ${modelBar(view)}
  <div class="sect">公式</div>
  ${paletteTable()}
  <form id="preview-form" method="post" action="/c/${id}/preview" style="display:none">
    <input type="hidden" name="msg" id="preview-msg">
  </form>
</div>
<script>${composerScript(runTail(view.sessionId, view.cursor, view.running, Boolean(view.fresh), Boolean(view.fresh), view.window))}</script>`

  return shell(view.title || '会话', body, {
    fontSize: config.fontSize,
    bodyClass: 'hei',
    indent: config.indent,
  })
}

function runTail(
  sessionId: string,
  cursor?: number,
  running?: boolean,
  jump?: boolean,
  fresh?: boolean,
  windowSize?: number,
): string {
  const id = JSON.stringify(String(sessionId))
  const start = JSON.stringify(Number(cursor) || 0)
  const size = JSON.stringify(Number(windowSize) || 0)
  const isRunning = running ? 'true' : 'false'
  return `
(function(){
  var id=${id},cursor=${start},running=${isRunning},idle=0,jump=${jump ? 'true' : 'false'},fresh=${fresh ? 'true' : 'false'},n=${size};
  function byId(n){return document.getElementById(n);}
  function setState(text){
    var s=byId('state');
    if(!s)return;
    s.innerHTML=text;
    s.style.display=text?'block':'none';
  }
  function pageHeight(){
    return document.documentElement.scrollHeight||document.body.scrollHeight||0;
  }
  function atBottom(){
    var y=window.pageYOffset||document.documentElement.scrollTop||document.body.scrollTop||0;
    return y+window.innerHeight>=pageHeight()-260;
  }
  function apply(d){
    var box=byId('msgs');
    if(!box)return false;
    var stick=atBottom();
    if(d.mode==='replace'&&!stick)return false;
    if(d.mode==='replace'){box.innerHTML=d.html;}
    else if(d.html){
      if(box.insertAdjacentHTML){box.insertAdjacentHTML('beforeend',d.html);}
      else{box.innerHTML+=d.html;}
    }
    if(stick){window.scrollTo(0,pageHeight());}
    return true;
  }
  if(jump){window.scrollTo(0,pageHeight());}
  function tick(){
    var x=new XMLHttpRequest();
    x.open('GET','/c/'+encodeURIComponent(id)+'/tail?since='+cursor+'&n='+n,true);
    x.onreadystatechange=function(){
      if(x.readyState!==4)return;
      if(x.status!==200){setTimeout(tick,6000);return;}
      var d=null;
      try{d=JSON.parse(x.responseText);}catch(e){setTimeout(tick,6000);return;}
      var shown=apply(d);
      if(shown){cursor=d.cursor;}
      running=d.running===1;
      setState(running?'生成中 · 新内容自动追加':'');
      var btn=byId('stopbtn');
      if(btn){btn.style.display=running?'':'none';}
      if(running){idle=0;setTimeout(tick,3000);return;}
      if(!shown){setTimeout(tick,15000);return;}
      idle++;
      if(idle<25){setTimeout(tick,(fresh&&idle<=12)?4000:15000);}
    };
    x.send(null);
  }
  setTimeout(tick, running?1200:4000);
})();`
}

export function renderFiles(config: KindleConfig, view: FilesView): string {
  const query = view.sessionId ? '&s=' + encodeURIComponent(view.sessionId) : ''
  const back = view.sessionId
    ? `<a href="/c/${encodeURIComponent(view.sessionId)}">‹ 会话</a>`
    : `<a href="/s">‹ 列表</a>`
  const dirHref = (path: string) => '/files?p=' + encodeURIComponent(path) + query
  const self = dirHref(view.dir)
  const crumbs = view.crumbs
    .map((crumb, index) =>
      index === view.crumbs.length - 1
        ? '<span>' + escapeHtml(crumb.name) + '</span>'
        : '<a href="' + escapeHtml(dirHref(crumb.path)) + '">' + escapeHtml(crumb.name) + '</a> › ',
    )
    .join('')
  const up = view.parent
    ? '<a class="row" href="' +
      escapeHtml(dirHref(view.parent)) +
      '"><table><tr><td class="t"><div class="ttl">‹ 上一级</div></td><td class="g"></td></tr></table></a>'
    : ''
  const rows = view.entries
    .map((entry) => {
      const meta = entry.dir
        ? '目录'
        : formatSize(entry.size) + (entry.updatedAt ? ' · ' + formatTime(entry.updatedAt) : '')
      const inner =
        '<table><tr><td class="t"><div class="ttl">' +
        escapeHtml(entry.name) +
        '</div><p class="meta">' +
        meta +
        (entry.kind === 'other' ? ' · 不能预览' : '') +
        '</p></td><td class="g">' +
        (entry.dir || entry.kind !== 'other' ? '›' : '') +
        '</td></tr></table>'
      if (entry.dir)
        return '<a class="row" href="' + escapeHtml(dirHref(entry.path)) + '">' + inner + '</a>'
      if (entry.kind === 'other') return '<div class="row dim">' + inner + '</div>'
      const from = encodeURIComponent(self)
      const base =
        entry.kind === 'md'
          ? '/f?p=' + encodeURIComponent(entry.path) + '&from=' + from
          : entry.kind === 'text'
            ? '/t?p=' + encodeURIComponent(entry.path) + '&from=' + from
            : '/i?p=' + encodeURIComponent(entry.path) + '&from=' + from
      return '<a class="row" href="' + escapeHtml(base) + '">' + inner + '</a>'
    })
    .join('\n')
  const sub =
    view.label + ' · ' + view.entries.length + ' 项' + (view.truncated ? ' · 只列前 60 项' : '')
  const body = `
${toolBar(back, `<a href="${escapeHtml(self)}">刷新</a>`)}
${pageHead('文件', sub)}
<div class="pad bc">${crumbs}</div>
${up}${rows || '<div class="empty"><p class="t">这个目录是空的</p><p class="hint">往工作区里写点东西，再回来刷新。</p></div>'}`
  return shell('文件', body, { fontSize: config.fontSize, indent: config.indent })
}

export function renderTextView(config: KindleConfig, view: TextView): string {
  const from = view.from || '/files'
  const self =
    '/t?p=' +
    encodeURIComponent(view.path) +
    (view.from ? '&from=' + encodeURIComponent(view.from) : '')
  const sub =
    view.dir +
    ' · ' +
    formatSize(view.size) +
    (view.updatedAt ? ' · ' + formatTime(view.updatedAt) : '')
  const body = `
${toolBar(`<a href="${escapeHtml(from)}">‹ 返回</a>`, `<a href="${escapeHtml(self)}">刷新</a>`)}
${pageHead(view.name, sub)}
<div class="msg a"><div class="body"><pre class="plain">${escapeHtml(view.source)}</pre></div></div>
`
  return shell(view.name, body, { fontSize: config.fontSize, bodyClass: 'hei' })
}

export function renderFile(config: KindleConfig, view: FileView): string {
  const fontPx = config.fontSize
  const back = view.from || '/files'
  const self =
    '/f?p=' +
    encodeURIComponent(view.path) +
    (view.from ? '&from=' + encodeURIComponent(view.from) : '')
  const doc = renderMarkdownDoc(view.source, { fontPx, cwd: view.dir, from: view.from })

  // The Kindle browser cannot follow #anchors, so the table of contents reloads
  // the page starting at the chosen heading instead of jumping down the page.
  type Head = { level: number; text: string; block: number }
  const heads = doc.headings.filter((head: Head) => head.level <= 3)
  const asked = typeof view.at === 'number' ? view.at : NaN
  const start = heads.find((head: Head) => head.block === asked)
  const html = start ? doc.blocks.slice(start.block).join('\n') : doc.html
  const sub =
    view.dir +
    ' · ' +
    formatSize(view.size) +
    (view.updatedAt ? ' · ' + formatTime(view.updatedAt) : '')

  const toc =
    !start && heads.length >= 3
      ? '<div class="pad"><div class="sect">目录</div><div class="toc">' +
        heads
          .map(
            (head: Head) =>
              `<a class="lv${Math.min(head.level, 3)}" href="${escapeHtml(self + '&at=' + head.block)}">` +
              escapeHtml(head.text) +
              '</a>',
          )
          .join('') +
        '</div></div>'
      : ''
  const where = start
    ? `<div class="pad"><p class="hint">从「${escapeHtml(start.text)}」开始 · <a href="${escapeHtml(self)}">显示全文</a></p></div>`
    : ''

  const body = `
${toolBar(`<a href="${escapeHtml(back)}">‹ 返回</a>`, `<a href="${escapeHtml(self)}">刷新</a>`)}
${pageHead(view.name, sub)}
${where}${toc}
<div class="msg a"><div class="body">${html}</div></div>
`
  return shell(view.name, body, {
    fontSize: config.fontSize,
    bodyClass: 'hei',
    indentArt: config.indentArt,
  })
}

/** One image, fitted to the screen width. e-ink is happiest with a plain <img>. */
export function renderImage(config: KindleConfig, view: ImageView): string {
  const back = view.from || '/files'
  const src = '/img?p=' + encodeURIComponent(view.path)
  const sub =
    view.dir +
    ' · ' +
    formatSize(view.size) +
    (view.updatedAt ? ' · ' + formatTime(view.updatedAt) : '')
  const body = `
${toolBar(`<a href="${escapeHtml(back)}">‹ 返回</a>`, `<a href="${escapeHtml(src)}">原图</a>`)}
${pageHead(view.name, sub)}
<div class="shot"><img src="${escapeHtml(src)}" alt="${escapeHtml(view.name)}"></div>
`
  return shell(view.name, body, { fontSize: config.fontSize, bodyClass: 'hei' })
}

export function renderPreview(config: KindleConfig, view: PreviewView): string {
  const fontPx = config.fontSize
  const converted = convertPromptMath(String(view.draft || ''))
  const rendered = converted.trim()
    ? inline(converted, fontPx)
    : '<span class="hint">（还没有内容）</span>'
  const id = escapeHtml(view.sessionId)

  const body = `
${toolBar(`<a href="/c/${id}">‹ 返回会话</a>`, '')}
${pageHead('预览')}
<div class="msg a"><div class="who">渲染结果</div><div class="body">${rendered}</div></div>
<div class="composer">
  <div class="sect">输入</div>
  <p class="hint">确认无误后直接发送；也可以修改后再次预览。</p>
  <form method="post" action="/c/${id}/send">
    <textarea id="msg" name="msg" rows="7">${escapeHtml(view.draft || '')}</textarea>
    <div class="stack">
      <button type="submit" class="btn primary">发送</button>
      <button type="button" class="btn" onclick="return doPreview()">再次预览</button>
    </div>
  </form>
  <div class="sect">公式</div>
  ${paletteTable()}
  <form id="preview-form" method="post" action="/c/${id}/preview" style="display:none">
    <input type="hidden" name="msg" id="preview-msg">
  </form>
</div>

<script>${composerScript('')}</script>`

  return shell('预览', body, { fontSize: config.fontSize, indent: config.indent })
}

function formatSize(bytes: number): string {
  const size = Number(bytes) || 0
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatTime(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatWhen(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= today) return `今天 ${hm}`
  if (ms >= today - 86400000) return `昨天 ${hm}`
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md}`
}

export { texToSvg }
