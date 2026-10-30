/**
 * Page shell, styles, and the three server-rendered pages.
 *
 * Everything here targets WebKit 531/534 (Safari 4/5): no flexbox, no grid,
 * no `position: fixed`, no `fetch`, no template literals in shipped JS. The
 * only client-side script is the run-state poller and a tiny caret inserter.
 */
// Hot reload: carry this module's own ?gen=N stamp (empty when imported
// in place, e.g. by the tests) into every dependency, so one generation of the
// UI never renders with another generation's math/markdown code.
const STAMP = new URL(import.meta.url).search;
const { escapeHtml, texToSvg, convertPromptMath } = await import('./math.js' + STAMP);
const { renderMarkdown, inline } = await import('./markdown.js' + STAMP);
const PALETTE = [
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
];
const STYLE = (fontSize) => `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:serif;font-size:${fontSize}px;line-height:1.72;padding:0 32px 64px;-webkit-text-size-adjust:100%}
a{color:#000;text-decoration:underline}
/* Session page uses a 黑体 stack for everything except the page title. */
.hei{font-family:"STHeiti","Heiti SC","PingFang SC","Microsoft YaHei","Droid Sans Fallback","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Zen Hei","FZHei","SimHei",sans-serif}
.hei h1{font-family:serif}
.hei textarea,.hei input[type=password],.hei input[type=text]{font-family:inherit}
h1{font-size:1.12em;line-height:1.4;margin:12px 0 8px;padding-bottom:12px;border-bottom:3px solid #000}
h2,h3,h4{font-size:1em;margin:22px 0 8px}
p{margin:14px 0}
ul,ol{margin:14px 0;padding-left:40px}
li{margin:6px 0}
hr{border:0;border-top:3px solid #ccc;margin:24px 0}

/* top navigation: large tap targets, wraps instead of floating */
.nav{padding:10px 0 4px;border-bottom:3px solid #000;margin-bottom:14px;font-family:sans-serif}
.nav a{display:inline-block;padding:14px 18px;margin:0 10px 8px 0;border:2px solid #000;background:#f0f0f0;color:#000;text-decoration:none;font-size:0.58em;line-height:1.1}
.nav strong{font-size:0.62em;margin-right:10px}

/* messages: a left accent bar makes the thread scannable on e-ink */
.msg{border:1px solid #c8c8c8;border-left:14px solid #999;padding:16px 18px;margin:22px 0}
.msg.u{border-left-color:#000;background:#f2f2f2}
.msg .who{font-family:sans-serif;font-size:0.54em;color:#444;letter-spacing:0.12em;margin-bottom:10px}
.msg .body{overflow:hidden}
.msg .body > *:first-child{margin-top:0}
.msg .body > *:last-child{margin-bottom:0}

/* tool chatter collapses into one shaded log so it does not bury the answer */
.msg.tools{border:0;border-left:8px solid #bbb;background:#fafafa;padding:12px 16px;margin:14px 0}
.msg.tools .who{letter-spacing:0.08em;margin-bottom:4px}
.toolrow{margin:12px 0}
.toolname{font-family:monospace;font-size:0.54em;color:#222;margin-bottom:4px}
.toolbody{font-family:monospace;font-size:0.5em;line-height:1.5;color:#555;white-space:pre-wrap;word-wrap:break-word}
.toolbody.err{color:#8a0000}

/* formulas */
.mathblock{text-align:center;margin:18px 0;overflow:hidden}
svg{max-width:100%}
.matherr{font-family:monospace;font-size:0.58em;background:#f4f4f4;border:1px dotted #888;padding:3px 6px;word-wrap:break-word}

/* code */
pre.code{font-family:monospace;font-size:0.6em;line-height:1.5;background:#f5f5f5;border:1px solid #bbb;padding:12px;white-space:pre-wrap;word-wrap:break-word;margin:16px 0}
code{font-family:monospace;font-size:0.8em;background:#f0f0f0;padding:1px 4px;word-wrap:break-word}
blockquote{border-left:8px solid #ddd;margin:16px 0;padding-left:16px;color:#333}

/* tables: shrink and wrap rather than overflow the screen */
table{border-collapse:collapse;margin:16px 0;font-size:0.62em;max-width:100%}
td,th{border:1px solid #999;padding:6px 8px;vertical-align:top;word-wrap:break-word}

/* composer */
.composer{border-top:3px solid #000;margin-top:30px;padding-top:18px}
textarea{display:block;width:100%;font-family:serif;font-size:${fontSize}px;line-height:1.55;border:3px solid #000;padding:12px;background:#fff;color:#000;min-height:9em}
input[type=password],input[type=text]{display:block;width:100%;font-size:${fontSize}px;border:3px solid #000;padding:12px}
button{font-family:sans-serif;font-size:0.72em;line-height:1.1;padding:18px 26px;border:2px solid #000;background:#f0f0f0;color:#000;margin:0 12px 10px 0}
button.primary{background:#000;color:#fff}
button.wide{display:block;width:100%;text-align:center;font-size:0.78em;padding:20px 0;margin:6px 0 10px}
.palette{margin:14px 0 0}
.palette button{width:15.6%;margin:0 0.8% 8px 0;padding:14px 0;font-size:0.56em;text-align:center}
.pad{padding:12px 0}
.older{text-align:center;font-size:0.6em;margin:6px 0 0}
.bal{font-family:sans-serif;font-size:0.62em;margin:12px 0 0}
.modelbar{font-family:sans-serif;font-size:0.62em;margin:12px 0 0;color:#333}
.modelbar .label{margin-right:8px}
.modelbar form{display:inline-block;margin:0}
.modelbar .mini{font-size:1em;padding:9px 18px}
.mini.on{background:#000;color:#fff;border-color:#000}
.big{font-size:1.25em;margin:14px 0}
.hint{font-family:sans-serif;font-size:0.58em;line-height:1.6;color:#555}

/* running indicator: only rendered while a turn is live */
.state{display:inline-block;font-family:sans-serif;font-size:0.58em;font-weight:bold;border:2px solid #000;padding:10px 14px;margin:0 0 14px;background:#fff}

/* session list */
.session{border-bottom:2px solid #ddd;padding:18px 0}
.session a.title{display:block;font-size:1.05em;font-weight:bold;line-height:1.45;word-wrap:break-word}
.meta{font-family:sans-serif;font-size:0.54em;color:#555;margin-top:8px}
.meta .flag{border:2px solid #000;padding:2px 8px;margin-right:8px}
.actions{margin-top:12px}
.actions form{display:inline-block;margin:0}
.mini{display:inline-block;font-family:sans-serif;font-size:0.52em;line-height:1.1;padding:10px 16px;margin:0 12px 0 0;border:2px solid #000;background:#f0f0f0;color:#000;text-decoration:none}
input.mini{font-size:0.52em;padding:10px 16px;background:#f0f0f0}
`;
function shell(title, body, opts = {}) {
    const fontSize = opts.fontSize || 30;
    const bodyClass = opts.bodyClass ? ` class="${opts.bodyClass}"` : '';
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${STYLE(fontSize)}</style>
</head><body${bodyClass}>
${body}
</body></html>`;
}
export function renderLogin(config, next, options) {
    const failed = Boolean(options && options.error);
    const body = `
<div class="nav"><strong>DSH · Kindle</strong></div>
<h1>需要访问令牌</h1>
${failed ? '<p class="state">令牌不对，再试一次。</p>' : ''}
<form method="post" action="/login">
  <input type="hidden" name="next" value="${escapeHtml(next || '/s')}">
  <p class="hint">在 Kindle 上输入你在电脑端配置的 token。</p>
  <p><input type="password" name="token" autocomplete="off"></p>
  <p><button type="submit" class="primary">进入</button></p>
</form>
<p class="hint">省事的做法：在电脑上打开日志里打印的登录链接（带 ?t=…），把它抄成 Kindle 的地址打开一次，之后就不用再输令牌了。</p>`;
    return shell('登录', body, { fontSize: config.fontSize });
}
export function renderList(config, sessions, notice, extras = {}) {
    const rows = sessions.length
        ? sessions
            .map((s) => {
            const when = formatTime(s.updatedAt);
            const flags = [
                s.running ? '<span class="flag">生成中</span>' : '',
                s.blank ? '<span class="flag">空会话</span>' : '',
            ].filter(Boolean).join('');
            const id = escapeHtml(s.sessionId);
            return `<div class="session">
  <a class="title" href="/c/${id}">${escapeHtml(s.title)}</a>
  <div class="meta">${when} ${flags}</div>
  <div class="actions">
    <form method="post" action="/c/${id}/fork"><input type="submit" class="mini" value="分叉"></form>
    <a class="mini" href="/c/${id}/rename">改名</a>
    <a class="mini" href="/c/${id}/delete">删除</a>
  </div>
</div>`;
        })
            .join('\n')
        : '<p class="hint">这里还没有会话。点上面的「新会话」开一个。</p>';
    const balance = extras.balance
        ? `<p class="bal"><a href="/me">余额 ${escapeHtml(extras.balance)}</a></p>`
        : '';
    const body = `
<div class="nav"><strong>DSH · Kindle</strong><a href="/s">刷新</a><a href="/me">账户</a></div>
${balance}
<form method="post" action="/new"><button type="submit" class="primary wide">＋ 新会话</button></form>
${notice ? `<p class="state">${escapeHtml(notice)}</p>` : ''}
${rows}`;
    return shell('DSH Kindle', body, { fontSize: config.fontSize });
}
export function renderRename(config, view) {
    const id = escapeHtml(view.sessionId);
    const body = `
<div class="nav"><a href="/s">会话列表</a><a href="/c/${id}">‹ 返回会话</a></div>
<h1>改名</h1>
<form method="post" action="/c/${id}/rename">
  <p><input type="text" name="title" value="${escapeHtml(view.title || '')}" autocomplete="off"></p>
  <p class="hint">留空会由模型自动生成标题。改名只影响显示。</p>
  <p><button type="submit" class="primary">保存</button> <a href="/c/${id}">取消</a></p>
</form>`;
    return shell('改名', body, { fontSize: config.fontSize });
}
export function renderDelete(config, view) {
    const id = escapeHtml(view.sessionId);
    const body = `
<div class="nav"><a href="/s">会话列表</a><a href="/c/${id}">‹ 返回会话</a></div>
<h1>删除这个会话？</h1>
<p>${escapeHtml(view.title || '（未命名会话）')}</p>
<p class="hint">会话会从 Kindle 列表里移除，文件仍保留在 ${escapeHtml(view.cwd || '')} 下，电脑端可以找回。正在生成的会话要先停止。</p>
<form method="post" action="/c/${id}/delete">
  <p><button type="submit" class="primary">删除</button> <a href="/c/${id}">取消</a></p>
</form>`;
    return shell('删除会话', body, { fontSize: config.fontSize });
}
/**
 * @param {object} config
 * @param {object} view
 * @param {string} view.sessionId
 * @param {string} view.title
 * @param {Array<object>} view.messages
 * @param {boolean} view.running
 * @param {number} view.updatedAt
 * @param {boolean} view.hasOlder
 * @param {number} view.window
 */
/** Reasoning-effort switch for the session's current model route. */
const EFFORT_LABELS = { off: '关', low: '低', medium: '中', high: '高', max: '最大' };
function modelBar(view) {
    const model = view.model;
    if (!model || !Array.isArray(model.efforts) || model.efforts.length < 2)
        return '';
    const buttons = model.efforts
        .map((effort) => {
        const active = effort.id === model.current;
        const label = escapeHtml(EFFORT_LABELS[effort.id] || effort.name || effort.id);
        return active
            ? `<button type="button" class="mini on" disabled>${label}</button>`
            : `<button type="submit" name="effort" value="${escapeHtml(effort.id)}" class="mini">${label}</button>`;
    })
        .join(' ');
    // A deployment default can name an effort the adapter no longer lists
    // (`reasoningEffort: max` from config). Show it rather than nothing.
    if (model.current && !model.efforts.some((effort) => effort.id === model.current)) {
        buttons += ` <button type="button" class="mini on" disabled>${escapeHtml(EFFORT_LABELS[model.current] || model.current)}</button>`;
    }
    const title = model.name ? ` title="${escapeHtml(model.name)}"` : '';
    return `<div class="modelbar"${title}><span class="label">思考</span>
<form method="post" action="/c/${escapeHtml(view.sessionId)}/effort">${buttons}</form></div>`;
}
/** Account readout: platform wallets plus the links to use/top up. */
export function renderAccount(config, view) {
    const account = view.account || {};
    const links = account.links || {};
    const out = [`<div class="nav"><a href="/s">‹ 列表</a><a href="/me">刷新</a></div>`, '<h1>账户</h1>'];
    if (account.ok) {
        for (const wallet of account.wallets) {
            out.push(`<p class="big">余额 <strong>${escapeHtml(wallet.text)}</strong></p>`);
        }
        if (account.bonuses && account.bonuses.length) {
            const text = account.bonuses.map((wallet) => wallet.text).join(' / ');
            out.push(`<p class="hint">另有赠送余额 ${escapeHtml(text)}（不计入上面的余额）</p>`);
        }
    }
    else if (account.reason === 'no-service') {
        out.push('<p>这个 Host 没有挂载账户服务，读不到余额。</p>');
    }
    else if (account.reason === 'signed-out') {
        out.push('<p>还没有登录 DeepSeek 平台账号，所以没有余额可读。</p>');
    }
    else {
        out.push('<p>余额暂时读不到（网络或登录状态）。</p>');
    }
    const actions = [];
    if (links.usageUrl)
        actions.push(`<a href="${escapeHtml(links.usageUrl)}">查看用量</a>`);
    if (links.topUpUrl)
        actions.push(`<a href="${escapeHtml(links.topUpUrl)}">去充值</a>`);
    if (actions.length)
        out.push(`<p class="pad">${actions.join(' · ')}</p>`);
    out.push('<p class="hint">余额由平台账户接口读取，本机缓存两分钟。</p>');
    return shell('账户', out.join('\n'), { fontSize: config.fontSize });
}
export function renderMessages(config, messages) {
    const fontPx = config.fontSize;
    const parts = [];
    let tools = [];
    // Tool calls are the noisiest thing on the page. Group a run of them into one
    // compact panel so the conversation keeps its shape.
    function flushTools() {
        if (!tools.length)
            return;
        const rows = tools.map((tool) => {
            const snippet = tool.text.length > 160 ? tool.text.slice(0, 160) + ' …' : tool.text;
            return `<div class="toolrow"><div class="toolname">⚙ ${escapeHtml(tool.name)}${tool.error ? ' · 失败' : ''}</div><div class="toolbody${tool.error ? ' err' : ''}">${escapeHtml(snippet)}</div></div>`;
        }).join('');
        parts.push(`<div class="msg tools"><div class="who">工具 · ${tools.length} 次</div>${rows}</div>`);
        tools = [];
    }
    for (const message of messages) {
        if (message.kind === 'tool') {
            if (message.text)
                tools.push(message);
            continue;
        }
        flushTools();
        if (message.kind === 'user') {
            parts.push(`<div class="msg u"><div class="who">你</div><div class="body">${renderUserText(message.text, fontPx)}</div></div>`);
        }
        else if (message.kind === 'assistant') {
            const tail = message.interrupted ? '<div class="hint">（已中断）</div>' : '';
            parts.push(`<div class="msg a"><div class="who">DSH</div><div class="body">${renderMarkdown(message.text, { fontPx })}${tail}</div></div>`);
        }
    }
    flushTools();
    return parts.join('\n') || '<p class="hint">还没有内容。</p>';
}
export function renderSession(config, view) {
    const older = view.hasOlder
        ? `<p class="older"><a href="/c/${escapeHtml(view.sessionId)}?n=${view.window + config.pageSize}">↑ 更早的消息</a></p>`
        : '';
    const palette = PALETTE.map(([label, snippet]) => {
        return `<button type="button" onclick="ins('${snippet.replace(/'/g, "\\'")}')">${escapeHtml(label)}</button>`;
    }).join('');
    const body = `
<div class="nav">
  <a href="/s">‹ 列表</a>
  <a href="/c/${escapeHtml(view.sessionId)}">刷新</a>
  <a href="/c/${escapeHtml(view.sessionId)}/rename">改名</a>
  <a href="/c/${escapeHtml(view.sessionId)}/delete">删除</a>
  <a href="#composer">✎ 输入</a>
</div>
<h1>${escapeHtml(view.title || '会话')}</h1>
${modelBar(view)}
<p class="state" id="state" style="${view.running ? '' : 'display:none'}">${view.running ? '生成中……（新内容会自动追加）' : ''}</p>
${older}
<div id="msgs">${renderMessages(config, view.messages)}</div>
<div class="composer" id="composer">
  <form method="post" action="/c/${escapeHtml(view.sessionId)}/send">
    <p class="hint">公式用 $…$ 包起来，用 AsciiMath 语法（例：$sqrt(x^2+y^2)$、$int_0^1 f(x) dx$）。</p>
    <textarea id="msg" name="msg" rows="7">${escapeHtml(view.draft || '')}</textarea>
    <div class="pad">
      <button type="submit" class="primary">发送</button>
      <button type="button" onclick="return doPreview()">预览公式</button>
      <button type="button" id="stopbtn" onclick="return doStop()" style="${view.running ? '' : 'display:none'}">停止生成</button>
    </div>
  </form>
  <div class="palette">${palette}</div>
  <form id="preview-form" method="post" action="/c/${escapeHtml(view.sessionId)}/preview" style="display:none">
    <input type="hidden" name="msg" id="preview-msg">
  </form>
  <form id="stop-form" method="post" action="/c/${escapeHtml(view.sessionId)}/stop" style="display:none"></form>
</div>

<script>
var ta=document.getElementById('msg');
function ins(s){
  var a=ta.value,b=ta.selectionStart,c=ta.selectionEnd,d='';
  if(typeof b==='number'&&typeof c==='number'){d=a.substring(0,b)+s+a.substring(c);}
  else{d=a+s;}
  ta.value=d;
  try{ta.focus();if(typeof b==='number'){ta.selectionStart=ta.selectionEnd=b+s.length;}}catch(e){}
}
function doPreview(){document.getElementById('preview-msg').value=ta.value;document.getElementById('preview-form').submit();return false;}
function doStop(){document.getElementById('stop-form').submit();return false;}
${runTail(view.sessionId, view.cursor, view.running, Boolean(view.fresh || view.running), Boolean(view.fresh))}
</script>`;
    return shell(view.title || '会话', body, { fontSize: config.fontSize, bodyClass: 'hei' });
}
/**
 * Incremental refresh: after the first full page, new messages arrive as an
 * HTML fragment and are appended in place. A full reload costs ~3.5s on the
 * device and throws away the draft, so this is the fast path; `replace` mode
 * covers the cases where the server cannot promise an append (pagination,
 * rewritten turns).
 */
function runTail(sessionId, cursor, running, jump, fresh) {
    const id = JSON.stringify(String(sessionId));
    const start = JSON.stringify(Number(cursor) || 0);
    const isRunning = running ? 'true' : 'false';
    return `
(function(){
  var id=${id},cursor=${start},running=${isRunning},idle=0,jump=${jump ? 'true' : 'false'},fresh=${fresh ? 'true' : 'false'};
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
    if(!box)return;
    var stick=atBottom();
    if(d.mode==='replace'){box.innerHTML=d.html;}
    else if(d.html){
      if(box.insertAdjacentHTML){box.insertAdjacentHTML('beforeend',d.html);}
      else{box.innerHTML+=d.html;}
    }
    if(stick){window.scrollTo(0,pageHeight());}
  }
  if(jump){window.scrollTo(0,pageHeight());}
  function tick(){
    var x=new XMLHttpRequest();
    x.open('GET','/c/'+encodeURIComponent(id)+'/tail?since='+cursor,true);
    x.onreadystatechange=function(){
      if(x.readyState!==4)return;
      if(x.status!==200){setTimeout(tick,6000);return;}
      var d=null;
      try{d=JSON.parse(x.responseText);}catch(e){location.reload();return;}
      apply(d);
      cursor=d.cursor;
      running=d.running===1;
      setState(running?'生成中……（内容会自动追加）':'');
      var btn=byId('stopbtn');
      if(btn){btn.style.display=running?'':'none';}
      if(running){idle=0;setTimeout(tick,3000);return;}
      idle++;
      // Right after a send the turn may not be flagged yet, so keep a short
      // interval for a while before settling into the slow idle poll.
      if(idle<25){setTimeout(tick,(fresh&&idle<=12)?4000:15000);}
    };
    x.send(null);
  }
  setTimeout(tick, running?1200:4000);
})();`;
}
export function renderPreview(config, view) {
    const fontPx = config.fontSize;
    const converted = convertPromptMath(String(view.draft || ''));
    const rendered = converted.trim()
        ? inline(converted, fontPx)
        : '<span class="hint">（还没有内容）</span>';
    const palette = PALETTE.map(([label, snippet]) => {
        return `<button type="button" onclick="ins('${snippet.replace(/'/g, "\\'")}')">${escapeHtml(label)}</button>`;
    }).join('');
    const body = `
<div class="nav"><a href="/c/${escapeHtml(view.sessionId)}">‹ 返回会话</a><strong>公式预览</strong></div>
<h1>预览</h1>
<div class="msg a"><div class="who">渲染结果</div><div class="body">${rendered}</div></div>
<div class="composer">
  <form method="post" action="/c/${escapeHtml(view.sessionId)}/send">
    <p class="hint">确认无误后直接发送；也可以修改后再次预览。</p>
    <textarea id="msg" name="msg" rows="7">${escapeHtml(view.draft || '')}</textarea>
    <div class="pad">
      <button type="submit" class="primary">发送</button>
      <button type="button" onclick="return doPreview()">再次预览</button>
    </div>
  </form>
  <div class="palette">${palette}</div>
  <form id="preview-form" method="post" action="/c/${escapeHtml(view.sessionId)}/preview" style="display:none">
    <input type="hidden" name="msg" id="preview-msg">
  </form>
</div>
<script>
var ta=document.getElementById('msg');
function ins(s){
  var a=ta.value,b=ta.selectionStart,c=ta.selectionEnd,d='';
  if(typeof b==='number'&&typeof c==='number'){d=a.substring(0,b)+s+a.substring(c);}
  else{d=a+s;}
  ta.value=d;
  try{ta.focus();if(typeof b==='number'){ta.selectionStart=ta.selectionEnd=b+s.length;}}catch(e){}
}
function doPreview(){document.getElementById('preview-msg').value=ta.value;document.getElementById('preview-form').submit();return false;}
</script>`;
    return shell('预览', body, { fontSize: config.fontSize });
}
function renderUserText(text, fontPx) {
    const html = inline(text, fontPx);
    return html;
}
function formatTime(ms) {
    if (!ms)
        return '';
    const d = new Date(ms);
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export { texToSvg };
