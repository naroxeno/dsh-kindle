import { renderMarkdown } from '../lib/markdown.js'
import { renderSession, renderList, renderPreview, renderSettings, renderFilesPin } from '../lib/ui.js'
import { convertPromptMath, texToSvg } from '../lib/math.js'
import { VERSION } from '../lib/index.js'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const t0 = Date.now()
const cfg = { fontSize: 30, pageSize: 6 }

const assistant = `## 解方程

由求根公式

$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$

代入 $a=1, b=-3, c=2$ 得 $x_1 = 1$, $x_2 = 2$。

- 第一点 **重点**
- 第二点 \`code\`

\`\`\`js
const x = 1
\`\`\`

| 名称 | 值 |
|---|---|
| a | 1 |
| b | -3 |

见 https://example.com 。

矩阵：

$$
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
$$

带编号：

$$
E = mc^2 \tag{1}
$$

无法解析的：$\\notacommand{1}$

不存在的环境：$\\begin{nosuchenv} x \\end{nosuchenv}$`

const html = renderMarkdown(assistant, { fontPx: 30 })
const t1 = Date.now()
const page = renderSession(cfg, {
  sessionId: 'sess-1',
  title: '测试会话',
  messages: [
    { kind: 'user', text: convertPromptMath('解 $frac{-b +- sqrt(b^2-4ac)}{2a}$ 这个公式') },
    { kind: 'assistant', text: assistant },
    { kind: 'tool', name: 'bash', text: 'total 12\ndrwxr-xr-x 2 user user 4096' },
  ],
  running: true,
  updatedAt: 1700000000000,
  hasOlder: true,
  window: 6,
})
const t2 = Date.now()
console.log('md ms', t1 - t0, 'page ms', t2 - t1, 'html KB', Math.round(page.length / 1024))
console.log('svg count', (page.match(/<svg/g) || []).length)
console.log('has ex unit:', /[\d.]+ex/.test(page))
console.log('matherr spans:', (page.match(/class="matherr"/g) || []).length)
console.log('merror leaked:', /merror/.test(page))
const m = page.match(/<svg[^>]*>/)
console.log('first svg tag:', m && m[0].slice(0, 200))
console.log('prompt conv:', convertPromptMath('求 $sum_(i=1)^n i$ 的值'))

// A running turn alone must not drag the page to the newest message: only a
// fresh send does. The window size has to survive both the refresh link and
// the tail poll, or reading an older window collapses back to six messages.
const base = {
  sessionId: 'sess-1',
  title: '测试会话',
  messages: [{ kind: 'user', text: 'hi' }],
  running: true,
  window: 6,
}
const runningPage = renderSession(cfg, base)
const freshPage = renderSession(cfg, { ...base, fresh: true })
assert.ok(runningPage.includes('jump=false'), 'running page must not jump')
assert.ok(freshPage.includes('jump=true'), 'fresh page must jump')
assert.ok(runningPage.includes('href="/c/sess-1?n=6"'), 'refresh keeps the window')
assert.ok(runningPage.includes("'&n='+n"), 'tail keeps the window')

// The list must read as plain text: titles in the body sans, recent times
// relative, and state shown by a dot instead of a reversed block.
const now = Date.now()
const listPage = renderList(
  cfg,
  [{ sessionId: 'sess-1', title: '列表测试', updatedAt: now, running: true }],
  undefined,
  { total: 1 },
)
assert.ok(!/\.row \.ttl\{[^}]*serif/.test(listPage), 'list titles are not serif')
assert.match(listPage, /今天 \d{2}:\d{2}/)
assert.ok(listPage.includes('● 生成中'), 'running shown as a dot')
assert.ok(!listPage.includes('class="grp"'), 'one day needs no headings')
const mixed = renderList(
  cfg,
  [
    { sessionId: 'a', title: '今天的', updatedAt: now },
    { sessionId: 'b', title: '旧的', updatedAt: now - 40 * 86400000 },
  ],
  undefined,
  { total: 2 },
)
assert.ok(mixed.includes('<div class="grp">今天</div>'), 'today group')
assert.ok(mixed.includes('<div class="grp">更早</div>'), 'older group')

// Hidden workspaces: the settings list leaves them out, the reveal entry sits
// behind the same file PIN, and only a revealed row offers the un-hide switch.
const settingsPage = renderSettings(cfg, {
  path: '/w/one',
  title: 'one',
  registered: true,
  registryReady: true,
  choices: [
    { id: 'a', path: '/w/one', title: 'one', current: true },
    { id: 'b', path: '/w/two', title: 'two' },
  ],
  ungrouped: 0,
  hiddenCount: 1,
})
assert.ok(settingsPage.includes('输入密码查看'), 'hidden hint links to the pin')
assert.ok(settingsPage.includes('/settings?hidden=1'))
assert.equal((settingsPage.match(/value="hide"/g) || []).length, 1, 'only non-current rows hide')
const revealPage = renderSettings(cfg, {
  path: '/w/one',
  title: 'one',
  registered: true,
  registryReady: true,
  choices: [
    { id: 'a', path: '/w/one', title: 'one', current: true },
    { id: 'b', path: '/w/two', title: 'two', hidden: true },
  ],
  ungrouped: 0,
  reveal: true,
  hiddenCount: 1,
})
assert.match(revealPage, /value="unhide"/)
assert.ok(revealPage.includes('已隐藏'))
const settingsPin = renderFilesPin(cfg, { next: '/settings?hidden=1', scope: 'settings' })
assert.ok(settingsPin.includes('隐藏工作区'), 'pin page knows its scope')
assert.ok(settingsPin.includes('value="/settings?hidden=1"'), 'pin keeps next')

// A published package must not disagree with the version it reports at runtime.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
console.log('version match:', VERSION === pkg.version, `(${VERSION} vs ${pkg.version})`)
if (VERSION !== pkg.version) process.exitCode = 1
