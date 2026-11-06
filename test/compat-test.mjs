import assert from 'node:assert/strict'
import {
  renderLogin,
  renderList,
  renderSession,
  renderPreview,
  renderAccount,
  renderNewSession,
} from '../lib/ui.js'

const config = { fontSize: 30, pageSize: 6 }
const answer = String.raw`## 解方程

由求根公式

$$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$

代入 $a=1, b=-3, c=2$ 得 $x_1 = 1$。`

const views = [
  {
    name: '登录',
    html: renderLogin(config, '/s', { error: true }),
    forms: true,
  },
  {
    name: '列表',
    html: renderList(
      config,
      [{ sessionId: 'sess-1', title: '测试会话', updatedAt: 1700000000000, running: true }],
      '测试提示',
      { balance: '余额 ¥12.34' },
    ),
    forms: false,
  },
  {
    name: '新会话',
    html: renderNewSession(config, {
      options: [
        { id: 'standard', name: '标准模式', description: '处理代码、文件和资料。', broken: '' },
        { id: 'minimal', name: '极简模式', description: '只用终端和图片读取。', broken: '' },
      ],
      defaultId: 'standard',
    }),
    forms: true,
  },
  {
    name: '会话',
    html: renderSession(config, {
      sessionId: 'sess-1',
      title: '测试会话',
      messages: [
        { kind: 'user', text: '求 $x^2$ 的值' },
        { kind: 'assistant', text: answer },
        { kind: 'tool', name: 'bash', text: 'total 12' },
      ],
      running: true,
      hasOlder: true,
      window: 6,
      draft: '继续',
      model: {
        name: 'deepseek-flash',
        efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }],
        current: 'low',
      },
      updatedAt: 1700000000000,
    }),
    formula: true,
    forms: true,
  },
  {
    name: '预览',
    html: renderPreview(config, { sessionId: 'sess-1', draft: '求 $frac{1}{2}$ 的值' }),
    formula: true,
    forms: true,
  },
  {
    name: '账户',
    html: renderAccount(config, {
      account: {
        ok: true,
        wallets: [{ text: '¥12.34' }],
        bonuses: [{ text: '¥2.00' }],
        links: { usageUrl: 'https://example.com/usage', topUpUrl: 'https://example.com/topup' },
      },
    }),
  },
]

const SCRIPT_FORBIDDEN = ['=>', '?.', '??', 'let ', 'const ', '`', 'async ']
const LAYOUT_FORBIDDEN = [/display\s*:\s*flex/, /display\s*:\s*grid/, /position\s*:\s*fixed/, /fetch\s*\(/]

for (const view of views) {
  const { name, html } = view
  assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html), `${name}: 外链脚本`)
  assert.ok(!/type\s*=\s*["']module["']/i.test(html), `${name}: module 脚本`)
  assert.ok(!/import\s*\(/.test(html), `${name}: 动态 import`)

  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const token of SCRIPT_FORBIDDEN) {
      assert.ok(!match[1].includes(token), `${name}: 内联脚本含 ${token}`)
    }
  }

  for (const pattern of LAYOUT_FORBIDDEN) {
    assert.ok(!pattern.test(html), `${name}: 含 ${pattern.source}`)
  }

  assert.ok(/<style\b/i.test(html), `${name}: 无内联样式`)
  assert.ok(!/<link\b[^>]*rel\s*=\s*["']stylesheet["']/i.test(html), `${name}: 外链样式`)
  assert.ok(!/<img\b/i.test(html), `${name}: 含 img`)
  assert.ok(!/<math\b/i.test(html), `${name}: 含 math`)
  if (view.formula) assert.ok(/<svg\b/i.test(html), `${name}: 公式未落成内联 svg`)

  const forms = [...html.matchAll(/<form\b[^>]*>/gi)].map((match) => match[0])
  if (view.forms) assert.ok(forms.length > 0, `${name}: 无表单`)
  for (const form of forms) {
    assert.match(form, /\bmethod\s*=\s*["']post["']/i, `${name}: 表单缺 method=post`)
    assert.match(form, /\baction\s*=\s*["'][^"']+["']/i, `${name}: 表单缺 action`)
  }
  assert.ok(!/method\s*=\s*["']get["']/i.test(html), `${name}: 含 method=get`)
}

console.log(`compat: ${views.length} 个页面通过 Kindle 兼容门`)
