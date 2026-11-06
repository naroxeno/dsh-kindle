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
const SANS = '"STHeiti","Heiti SC","PingFang SC","Microsoft YaHei","Droid Sans Fallback","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Zen Hei","FZHei","SimHei",sans-serif';
const STYLE = (fontSize) => `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:${SANS};font-size:${fontSize}px;line-height:1.7;padding-bottom:96px;-webkit-text-size-adjust:100%}
a{color:#000;text-decoration:none;outline:0}
.hei{font-family:${SANS}}
h1,h2,h3,h4{font-weight:bold;margin:0}

.tb{width:100%;border-collapse:collapse;border-bottom:2px solid #ddd}
.tb td{height:96px;padding:0;vertical-align:middle}
.tb .tl{text-align:left;padding-left:12px}
.tb .tr{text-align:right;padding-right:12px}
.tb a{display:inline-block;padding:24px 16px;font-size:0.9em;line-height:1.2;color:#000}
.tb .brand{display:inline-block;padding-left:12px;font-size:0.9em;font-weight:bold;letter-spacing:0.06em}

.hd{padding:8px 24px 18px;border-bottom:3px solid #000}
.hd h1{font-size:1.16em;line-height:1.35;word-wrap:break-word}
.hd .sub{margin:8px 0 0;font-size:0.82em;color:#555}

.row{display:block;border-bottom:2px solid #ddd;color:#000}
.row table{width:100%;height:100%;border-collapse:collapse}
.row td{padding:14px 0;vertical-align:middle}
.row td.t{padding-left:24px;padding-right:12px}
.row td.g{width:64px;text-align:center;font-size:1.25em;color:#777}
.row .ttl{font-family:serif;font-size:1em;font-weight:bold;line-height:1.32;word-wrap:break-word}
.row .meta{margin:5px 0 0;font-size:0.78em;color:#555}
.row .meta .n{margin-right:14px}
.row:active{background:#eaeaea}
.d3{width:100%;border-collapse:collapse;table-layout:fixed}
.d3 td{padding:0;vertical-align:middle}
.d3 td.mid{width:92px}
.dbtn{display:block;height:76px;line-height:70px;border:3px solid #000;background:#fff;color:#000;text-align:center;font-size:0.8em;text-decoration:none}
.dbtn:active{background:#dcdcdc}
.dbtn.off{color:#aaa;border-color:#bbb}
.dbtn.primary{background:#000;color:#fff;font-size:1.2em}
.dbtn.primary:active{background:#333}
.d3 td.prev .dbtn{margin-right:12px}
.d3 td.next .dbtn{margin-left:12px}
.flag{display:inline-block;border:2px solid #000;background:#000;color:#fff;padding:1px 10px;font-size:1em;line-height:1.35}
.flag.off{background:#fff;color:#000}

.strip{width:100%;border-collapse:collapse;table-layout:fixed;border-bottom:2px solid #ddd}
.strip td{padding:0;border-left:2px solid #ddd}
.strip td:first-child{border-left:0}
.cell{display:block;width:100%;height:96px;line-height:96px;padding:0;border:0;background:#fff;color:#000;text-align:center;font-size:0.88em;text-decoration:none}
.cell:active{background:#e8e8e8}

.mode{display:block;width:100%;text-align:left;padding:22px 24px;margin:0 0 18px;border:3px solid #000;background:#fff;color:#000;font:inherit}
.mode:active{background:#dcdcdc}
.mode .n{display:block;font-family:serif;font-size:1.02em;font-weight:bold;line-height:1.4}
.mode .d{display:block;margin-top:10px;font-size:0.8em;line-height:1.5;color:#444}
.mode .badge{font-size:0.72em;font-weight:normal;color:#555;border:1px solid #999;padding:1px 6px;margin-left:8px}
.mode[disabled]{opacity:0.45}

.lbl{margin:0 0 10px;font-size:0.82em;letter-spacing:0.06em;color:#555}
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
.msg .body h2,.msg .body h3,.msg .body h4{font-size:1.04em;line-height:1.4;margin:28px 0 12px}
.msg .body ul,.msg .body ol{margin:16px 0;padding-left:40px}
.msg .body li{margin:8px 0}
.msg .body hr{border:0;border-top:3px solid #ccc;margin:28px 0}
.msg .body blockquote{margin:20px 0;padding-left:18px;border-left:8px solid #ddd;color:#333}
.msg .body table{border-collapse:collapse;margin:20px 0;font-size:0.84em;max-width:100%}
.msg .body td,.msg .body th{border:2px solid #999;padding:8px 10px;vertical-align:top;word-wrap:break-word}
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

.st{padding:20px 24px;border-bottom:2px solid #ddd;background:#f1f1f1;font-size:0.86em}
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

body.ls{padding-bottom:0}
body.ls #scroll{padding-bottom:24px}
.dock{border-top:2px solid #000;background:#fff;padding:6px 24px 8px}
.dock .btn{height:110px;line-height:104px;font-size:1em}
`;
function shell(title, body, opts = {}) {
    const fontSize = opts.fontSize || 30;
    const bodyClass = opts.bodyClass ? ` class="${opts.bodyClass}"` : '';
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE(fontSize)}</style>
</head><body${bodyClass}>
${body}
</body></html>`;
}
function toolBar(left, right) {
    return `<table class="tb"><tr><td class="tl">${left}</td><td class="tr">${right}</td></tr></table>`;
}
function pageHead(title, sub) {
    return `<div class="hd"><h1>${escapeHtml(title)}</h1>${sub ? `<p class="sub">${escapeHtml(sub)}</p>` : ''}</div>`;
}
function paletteTable() {
    const rows = [];
    for (let i = 0; i < PALETTE.length; i += 4) {
        const cells = PALETTE.slice(i, i + 4)
            .map(([label, snippet]) => {
            const call = escapeHtml(JSON.stringify(snippet));
            return `<td><button type="button" onclick="ins(${call})">${escapeHtml(label)}</button></td>`;
        })
            .join('');
        rows.push(`<tr>${cells}</tr>`);
    }
    return `<table class="palette">${rows.join('')}</table>`;
}
function dockScript() {
    // Make the list end exactly at the bottom edge: the page must not scroll by
    // a few pixels, and the leftover height goes into the rows instead of a
    // white band above the dock.
    return `
var sc=document.getElementById('scroll'),hd=document.getElementById('head'),ft=document.getElementById('foot');
function fitRows(){
  if(!sc||!hd||!ft){return;}
  var rows=sc.getElementsByTagName('a'),i;
  for(i=0;i<rows.length;i++){rows[i].style.height='';}
  sc.style.minHeight='';
  var vh=document.documentElement.clientHeight||window.innerHeight||0;
  var cs=window.getComputedStyle?window.getComputedStyle(sc,null):null;
  var pad=cs?(parseFloat(cs.paddingBottom)||0):0;
  var avail=vh-hd.offsetHeight-ft.offsetHeight-pad;
  if(avail<=0){return;}
  if(rows.length){
    var each=Math.floor(avail/rows.length);
    if(each>0){
      for(i=0;i<rows.length;i++){
        rows[i].style.boxSizing='border-box';
        rows[i].style.webkitBoxSizing='border-box';
        rows[i].style.height=each+'px';
      }
    }
  }
  sc.style.minHeight=avail+'px';
}
fitRows();
window.onresize=fitRows;`;
}
function composerScript(extra) {
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
function doStop(){document.getElementById('stop-form').submit();return false;}
${extra}`;
}
export function renderLogin(config, next, options) {
    const failed = Boolean(options && options.error);
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
</div>`;
    return shell('登录', body, { fontSize: config.fontSize });
}
export function renderError(config, status, message) {
    const body = `
${toolBar('<a href="/s">‹ 列表</a>', '')}
${pageHead('出错了')}
<div class="pad">
<p class="value">${status}</p>
<p class="hint">${escapeHtml(message)}</p>
<div class="stack"><a class="btn" href="/s">返回会话列表</a></div>
</div>`;
    return shell('出错了', body, { fontSize: config.fontSize });
}
export function renderList(config, sessions, notice, extras = {}) {
    const rows = sessions.length
        ? sessions
            .map((s) => {
            const id = escapeHtml(s.sessionId);
            const flags = [
                s.running ? '<span class="flag">生成中</span>' : '',
                s.blank ? '<span class="flag off">空会话</span>' : '',
            ]
                .filter(Boolean)
                .join(' ');
            const meta = [formatTime(s.updatedAt), flags].filter(Boolean).join(' ');
            return `<a class="row" href="/c/${id}"><table><tr><td class="t"><div class="ttl">${escapeHtml(s.title)}</div><div class="meta">${meta}</div></td><td class="g">›</td></tr></table></a>`;
        })
            .join('')
        : '<div class="empty"><p class="t">这里还没有会话</p><p class="hint">点下面的「＋」开一个。</p></div>';
    // The balance lives in the top bar: it is one short wallet line, and the
    // scroll area is worth more to a session row on an e-ink screen.
    const balance = extras.balance ? `<a href="/me">${escapeHtml(extras.balance)}</a>` : '';
    const page = extras.page || 1;
    const pages = extras.pages || 1;
    const total = extras.total === undefined ? sessions.length : extras.total;
    const sub = [total ? `共 ${total} 个` : '', pages > 1 ? `第 ${page} / ${pages} 页` : '']
        .filter(Boolean)
        .join(' · ');
    const prev = page > 1
        ? `<a class="dbtn" href="/s?p=${page - 1}">‹ 上一页</a>`
        : '<span class="dbtn off">‹ 上一页</span>';
    const next = page < pages
        ? `<a class="dbtn" href="/s?p=${page + 1}">下一页 ›</a>`
        : '<span class="dbtn off">下一页 ›</span>';
    const dock = `<div id="dock" class="dock"><table class="d3"><tr><td class="prev">${prev}</td><td class="mid"><a class="dbtn primary" href="/new" aria-label="新会话">＋</a></td><td class="next">${next}</td></tr></table></div>`;
    const body = `
<div id="head">
${toolBar('<span class="brand">DSH · Kindle</span>', `${balance}<a href="/s">刷新</a>`)}
${pageHead('会话', sub)}
${notice ? `<div class="alert">${escapeHtml(notice)}</div>` : ''}
</div>
<div id="scroll">${rows}</div>
<div id="foot">${dock}</div>
<script>${dockScript()}</script>`;
    return shell('DSH Kindle', body, { fontSize: config.fontSize, bodyClass: 'ls' });
}
export function renderRename(config, view) {
    const id = escapeHtml(view.sessionId);
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
</div>`;
    return shell('改名', body, { fontSize: config.fontSize });
}
export function renderNewSession(config, view) {
    const cells = view.options.length
        ? view.options
            .map((option) => {
            const badge = option.id === view.defaultId ? '<span class="badge">默认</span>' : '';
            const detail = option.broken
                ? `<span class="d">暂不可用：${escapeHtml(option.broken)}</span>`
                : option.description
                    ? `<span class="d">${escapeHtml(option.description)}</span>`
                    : '';
            return `<form method="post" action="/new"><input type="hidden" name="preset" value="${escapeHtml(option.id)}"><button type="submit" class="mode"${option.broken ? ' disabled' : ''}><span class="n">${escapeHtml(option.name)}${badge}</span>${detail}</button></form>`;
        })
            .join('')
        : `<form method="post" action="/new"><button type="submit" class="btn primary">新建会话</button></form>`;
    const hint = view.options.length
        ? '<p class="hint">模式决定这个会话带哪些能力，开了以后不能换。</p>'
        : '<p class="hint">这套部署只配了一种模式。</p>';
    const body = `
${toolBar('<a href="/s">‹ 列表</a>', '')}
${pageHead('新会话', view.options.length > 1 ? '选一个模式' : '')}
<div class="pad">
${hint}
${cells}
</div>`;
    return shell('新会话', body, { fontSize: config.fontSize });
}
export function renderDelete(config, view) {
    const id = escapeHtml(view.sessionId);
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
</div>`;
    return shell('删除会话', body, { fontSize: config.fontSize });
}
const EFFORT_LABELS = {
    off: '关',
    low: '低',
    medium: '中',
    high: '高',
    max: '最大',
};
function modelBar(view) {
    const model = view.model;
    if (!model || !Array.isArray(model.efforts) || model.efforts.length < 2)
        return '';
    const action = `/c/${escapeHtml(view.sessionId)}/effort`;
    const choices = model.efforts.map((effort) => ({
        id: effort.id,
        label: EFFORT_LABELS[effort.id] || effort.name || effort.id,
    }));
    if (model.current && !choices.some((choice) => choice.id === model.current)) {
        choices.push({ id: model.current, label: EFFORT_LABELS[model.current] || model.current });
    }
    const cells = choices
        .map((choice) => {
        const label = escapeHtml(choice.label);
        const button = choice.id === model.current
            ? `<button type="button" class="mini on" disabled>${label}</button>`
            : `<button type="submit" name="effort" value="${escapeHtml(choice.id)}" class="mini">${label}</button>`;
        return `<td><form method="post" action="${action}">${button}</form></td>`;
    })
        .join('');
    const title = model.name ? ` title="${escapeHtml(model.name)}"` : '';
    return `<div class="modelbar"${title}><div class="lbl">思考强度</div><table class="seg"><tr>${cells}</tr></table></div>`;
}
export function renderAccount(config, view) {
    const account = view.account || {};
    const links = account.links || {};
    const out = [
        toolBar('<a href="/s">‹ 列表</a>', '<a href="/me">刷新</a>'),
        pageHead('账户'),
        '<div class="pad">',
    ];
    if (account.ok) {
        for (const wallet of account.wallets || []) {
            out.push('<div class="lbl">余额</div>');
            out.push(`<div class="value">${escapeHtml(wallet.text)}</div>`);
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
    out.push('</div>');
    const usage = links.usageUrl
        ? `<a class="row" href="${escapeHtml(links.usageUrl)}"><table><tr><td class="t"><div class="ttl">查看用量</div></td><td class="g">›</td></tr></table></a>`
        : '';
    const topUp = links.topUpUrl
        ? `<a class="row" href="${escapeHtml(links.topUpUrl)}"><table><tr><td class="t"><div class="ttl">去充值</div></td><td class="g">›</td></tr></table></a>`
        : '';
    out.push(usage, topUp);
    out.push('<div class="pad"><p class="hint">余额由平台账户接口读取，本机缓存两分钟。</p></div>');
    return shell('账户', out.join(''), { fontSize: config.fontSize });
}
export function renderMessages(config, messages, toolsHref) {
    const fontPx = config.fontSize;
    const parts = [];
    let tools = [];
    function flushTools() {
        if (!tools.length)
            return;
        if (toolsHref) {
            const failed = tools.filter((tool) => tool.error).length;
            const label = `⚙ 工具 · ${tools.length} 次${failed ? ' · ' + failed + ' 失败' : ''}`;
            parts.push(`<div class="msg tools"><a class="toolsum" href="${escapeHtml(toolsHref)}">${label} ›</a></div>`);
            tools = [];
            return;
        }
        const rows = tools
            .map((tool) => {
            const snippet = tool.text.length > 160 ? tool.text.slice(0, 160) + ' …' : tool.text;
            return `<div class="toolrow"><div class="toolname">⚙ ${escapeHtml(tool.name)}${tool.error ? ' · 失败' : ''}</div><div class="toolbody${tool.error ? ' err' : ''}">${escapeHtml(snippet)}</div></div>`;
        })
            .join('');
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
            parts.push(`<div class="msg u"><div class="who">你</div><div class="body">${inline(message.text, fontPx)}</div></div>`);
        }
        else if (message.kind === 'assistant') {
            const tail = message.interrupted ? '<p class="hint">（已中断）</p>' : '';
            parts.push(`<div class="msg a"><div class="who">DSH</div><div class="body">${renderMarkdown(message.text, { fontPx })}${tail}</div></div>`);
        }
    }
    flushTools();
    return parts.join('') || '<p class="hint">还没有内容。</p>';
}
export function renderTools(config, view) {
    const id = escapeHtml(view.sessionId);
    const count = view.tools.length;
    const total = Number(view.total) || count;
    const sub = (total > count ? `最近 ${count} / 共 ${total} 条` : `${count} 条`) +
        (formatTime(view.updatedAt) ? ' · 更新于 ' + formatTime(view.updatedAt) : '');
    const rows = view.tools
        .map((tool) => {
        const body = tool.text.length > 1600 ? tool.text.slice(0, 1600) + ' …' : tool.text;
        return `<div class="toolrow"><div class="toolname">⚙ ${escapeHtml(tool.name || 'tool')}${tool.error ? ' · 失败' : ''}</div><div class="toolbody${tool.error ? ' err' : ''}">${escapeHtml(body)}</div></div>`;
    })
        .join('');
    const page = `
${toolBar(`<a href="/c/${id}">‹ 会话</a>`, `<a href="/c/${id}/tools">刷新</a>`)}
${pageHead('工具调用', sub)}
<div class="msg tools">${rows || '<p class="hint">这段会话还没有工具调用。</p>'}</div>`;
    return shell('工具调用', page, { fontSize: config.fontSize });
}
export function renderSession(config, view) {
    const id = escapeHtml(view.sessionId);
    const older = view.hasOlder
        ? `<a class="older" href="/c/${id}?n=${view.window + config.pageSize}">↑ 更早的消息</a>`
        : '';
    const stop = view.running ? '' : ' style="display:none"';
    const body = `
${toolBar(`<a href="/s">‹ 列表</a>`, `<a href="/c/${id}">刷新</a>`)}
${pageHead(view.title || '会话', formatTime(view.updatedAt) ? `更新于 ${formatTime(view.updatedAt)}` : '')}
${modelBar(view)}
<table class="strip"><tr>
  <td><form method="post" action="/c/${id}/fork"><button type="submit" class="cell">分叉</button></form></td>
  <td><a class="cell" href="/c/${id}/rename">改名</a></td>
  <td><a class="cell" href="/c/${id}/delete">删除</a></td>
  <td><a class="cell" href="#composer">✎ 输入</a></td>
</tr></table>
<div class="st" id="state"${view.running ? '' : ' style="display:none"'}>${view.running ? '正在生成……（新内容会自动追加）' : ''}</div>
${older}
<div id="msgs">${renderMessages(config, view.messages, view.hasTools ? `/c/${id}/tools` : undefined)}</div>
<div class="composer" id="composer">
  <div class="sect">输入</div>
  <p class="hint">公式用 $…$ 包起来，用 AsciiMath 语法（例：$sqrt(x^2+y^2)$、$int_0^1 f(x) dx$）。</p>
  <form method="post" action="/c/${id}/send">
    <textarea id="msg" name="msg" rows="7">${escapeHtml(view.draft || '')}</textarea>
    <div class="stack">
      <button type="submit" class="btn primary">发送</button>
      <button type="button" class="btn" onclick="return doPreview()">预览公式</button>
      <button type="button" class="btn" id="stopbtn" onclick="return doStop()"${stop}>停止生成</button>
    </div>
  </form>
  <div class="sect">公式</div>
  ${paletteTable()}
  <form id="preview-form" method="post" action="/c/${id}/preview" style="display:none">
    <input type="hidden" name="msg" id="preview-msg">
  </form>
  <form id="stop-form" method="post" action="/c/${id}/stop" style="display:none"></form>
</div>

<script>${composerScript(runTail(view.sessionId, view.cursor, view.running, Boolean(view.fresh || view.running), Boolean(view.fresh)))}</script>`;
    return shell(view.title || '会话', body, { fontSize: config.fontSize, bodyClass: 'hei' });
}
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
      setState(running?'正在生成……（新内容会自动追加）':'');
      var btn=byId('stopbtn');
      if(btn){btn.style.display=running?'':'none';}
      if(running){idle=0;setTimeout(tick,3000);return;}
      idle++;
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
    const id = escapeHtml(view.sessionId);
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

<script>${composerScript('')}</script>`;
    return shell('预览', body, { fontSize: config.fontSize });
}
function formatTime(ms) {
    if (!ms)
        return '';
    const d = new Date(ms);
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export { texToSvg };
