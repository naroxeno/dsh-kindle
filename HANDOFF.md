# kindle-dsh 交接文档

写给下一个接手这个项目的会话。读完这一篇就能继续干活，不需要翻历史对话。

- 最后更新：2026-11-01
- 当前版本：bundle `0.3.1`（工作副本；profile 链着这个目录，0.3.1 已通过热重载在当前 dsh 进程里生效，壳没改、不用重启）
- 项目目录：`/home/naroxeno/main/kindle-dsh/`
- 一句话：把 DSH 会话搬进 Kindle Paperwhite 4 的原生浏览器，服务端渲染、无前端框架、公式用 MathJax 转成内联 SVG。

---

## 1. 现在能用的东西

| 项 | 值 |
| --- | --- |
| 设备 | Kindle Paperwhite 4（KPW4），固件 5.14.2，视口 1072×1268 CSS px，WebKit 534.26 |
| Kindle UI 地址 | `http://192.168.10.40:8090/`（插件自建 HTTP 监听，`0.0.0.0:8090`） |
| 登录链接 | `http://192.168.10.40:8090/login?t=<token>`（种一年期 `kd=` cookie） |
| 当前 token | `/home/naroxeno/kindle-ws/.kindle-token` → 目前是 6 位的 `kindle`（**建议换 24 位**，等于 shell 权限） |
| 会话工作区 | `/home/naroxeno/kindle-ws`（Kindle 建的会话都落在这里） |
| DSH host 进程 | `node /usr/sbin/dsh web`（GUI 在 `127.0.0.1:3080`），PID 每次重启会变 |
| 诊断页 | `http://127.0.0.1:8090/debug`（需要 cookie） |

`/debug` 正常输出长这样（`hot:` 行报告热重载代次，后四行是关键）：

```
kindle-ui 0.3.1
hot: generation 1 (0 reloads, auto on)
{"registered":0,"lastError":"","section":"kindle:display"}   ← 打开过会话后会变 1
prompt bytes: 1066
delete (workspace services): ready
account (balance): ready
model catalog: deepseek-official/deepseek-flash (off,low,high,max)
```

`registered: 0` 是正常的：进程刚启动、还没打开过任何会话，提示词只在第一次渲染会话页时按 agent 注册。

---

## 2. 改完代码怎么让它生效（0.3.0 起热重载）

**0.3.0 起：改 `lib/*.js` 或 `prompt/kindle.md` 不用重启 dsh。** 下一次 HTTP 请求自动换新代码，
`/debug` 的 `generation` 加一，端口/cookie/监听都不变。实现见第 4 节第 8 条。

> **源码位置（2026-10-30 迁移后）**：唯一手写源码在 `bundle/src/*.ts`，`lib/*.js` 由 `npm run build`（tsc）生成。
> 改行为请改 `src/` 再构建，**不要手改 `lib/*.js`**（`index.js`/`hot.js` 两个壳除外）。`hot.js` 的 `HOT_FILES` 已含 `generation.js`。
> 细节与里程碑见 `PLAN-TYPESCRIPT.md`。

仍然需要重启的情况（这些是壳，进程启动时加载）：

- 改 `lib/index.js` / `lib/hot.js`；
- 改 `cordis.patch.yml` 或 profile 里的 `config`（配置只读一次）；
- 升级/更换插件包后的第一次启动。

```bash
cd /home/naroxeno/main/kindle-dsh/bundle
npm test                       # 渲染 + HTTP + 热重载 + 真 Chromium，约 8 秒
# 改文件后（不需要 Ctrl-C）：
curl -s -b /tmp/kd.jar http://127.0.0.1:8090/debug | head -3   # generation 应加一
```

注意：

- 换代码发生在**下一次请求开始时**；正在渲染的上一代请求结束后才 dispose。
- 新代码有语法错误时旧代码继续服务，`/debug` 显示 `hot error: <时间> <原因>: <错误>`；修好后下一次请求恢复，同一份坏文件不会反复 import。
- 手动强制换一代：`curl -s -b /tmp/kd.jar 'http://127.0.0.1:8090/debug?reload=1'`。
- 跨代状态在 `globalThis` 的 Symbol 槽共享：MathJax 实例/SVG 缓存、按 agent 的提示词注册；`prompt/kindle.md` 改动会先撤销旧段再注册，所以不会 `already registered`。
- `plugin_manager` 的 `set_bundle` 仍然不会重新 import 模块图。判断“改动生效没有”先看 `/debug` 的 `generation`，别急着 kill 进程。

---


```
/home/naroxeno/main/kindle-dsh/
├── README.md             项目说明（中文，面向用户与开发者）
├── PACKAGING.md          发布评估：12 项标准对照、待定项、风险
├── HANDOFF.md            本文件
├── docs/                 截图（session/list/composer/account.png），1072×1268
├── spike/                阶段 0 真机自检页（历史产物，可删；server.mjs 起在 8090 会撞插件端口）
└── bundle/               真正发布的 npm 包
    ├── package.json      name=dsh-kindle, version 0.3.1, dsh.bundle.patch → cordis.patch.yml
    ├── cordis.patch.yml  插件默认配置（host/port/token/cwd/fontSize/pageSize/hotReload）
    ├── README.md         面向安装者：功能表、两条安装路径、配置、安全警告
    ├── CHANGELOG.md      0.1.1 → 0.3.1 的逐条记录
    ├── LICENSE           MIT
    ├── prompt/kindle.md  按会话注入的系统提示词（478 字）
    ├── docs/             打包用的截图
    ├── src/              唯一手写源码（.ts，npm run build → lib/；README 记录迁移约定）
    ├── scripts/          build.mjs（tsc）+ check-dist.mjs（逐字节比对）
    ├── lib/
    │   ├── index.js      插件入口：name/inject/apply → mount(hot.js)（约 25 行）
    │   ├── hot.js        稳定壳：配置、token、HTTP 监听、按文件指纹换代、/debug 兜底（560 行）
    │   ├── app.js        可热重载的一代：路由、页面、错误页（约 470 行，被 hot.js 以 ?gen=N 导入）
    │   ├── generation.js 按 ?gen= 加载五个兄弟模块的 11 字节入口（tsc 产物）
    │   ├── sessions.js   sessionController 适配层 + 日志读成消息（348 行）
    │   ├── math.js       TeX→SVG（MathJax），AsciiMath→LaTeX，跨代共享 engine/cache
    │   ├── markdown.js   极简 markdown → HTML（267 行，自写，无依赖）
    │   ├── ui.js         所有页面模板 + CSS + 内联轮询脚本（484 行）
    │   ├── account.js    余额读取与格式化、120s 缓存（123 行）
    │   └── prompt.js     按 agent 注册 `kindle:display` 系统提示词段（跨代 WeakMap + undo）
    └── test/
        ├── render-test.mjs    渲染 + 公式 + 版本一致性（无网络）
        ├── server-test.mjs    HTTP 真起服务、假 Host，28 项断言
        ├── hot-test.mjs       热重载全流程（临时副本 + 真服务 :8094）
        ├── integration-test.mjs 真 cordis + 假 host，7 项（验证 inject 作用域与插件激活）
        ├── browser-test.mjs   真 Chromium 跑轮询脚本（无 chromium 自动跳过）
        └── replay-test.mjs    手动：读真实 session.v4.jsonl.zstd 回放渲染
```

`npm test` = render + server + hot + browser 四套串行；`integration-test.mjs` 单独跑。

---


## 4. 架构（为什么长这样）

Kindle 的浏览器是 2010 年的 WebKit：没有 flex/grid/fetch/Promise/class，`position:fixed` 失效，外部 `<img src="x.svg">` 直接 0×0。所以：

1. **所有页面在 Host 渲染**：列表、会话、登录、改名、删除、账户、公式预览全是服务端拼好的 HTML 字符串，客户端只跑不到 30 行 ES5。
2. **自己的 HTTP 监听**：`dsh-host-webserver` 只绑 loopback，Kindle 连不上，所以插件自己 `http.createServer`，与 GUI 完全解耦（GUI 挂了/换端口都不影响 Kindle）。
3. **鉴权**：token 三种来源——config `token` → 环境变量 `DSH_KINDLE_TOKEN` → `<cwd>/.kindle-token`（不存在就生成 24 位并 0600 落盘）。比对用 `sha256` + `timingSafeEqual`；登录链接 `?t=` 种 `kd` cookie。
4. **会话归属**：只认 `cwd === 配置的 Kindle 工作区` 的会话，防止从 Kindle 侧误操作别的项目的会话。
5. **轮询而非流式**：页面不刷新，内联脚本每 3 秒（空闲 15 秒）打 `GET /c/:id/tail?since=<seq>`，返回 `{mode:'append'|'replace', html, cursor, running, version}`。`mode:'replace'` 出现在日志被改写（tool 结果替换、重试）时，保证不会留下过期气泡。
6. **公式**：输入 AsciiMath（`$frac{a}{b}$` 这种），发送前用 `asciimath-to-latex` 把每个 `$...$` 转成 LaTeX 交给模型；显示端只认 TeX，用 MathJax 转 SVG，服务端把 `ex` 换算成 px、给 `<path id>` 加前缀后内联。渲染失败输出 `<span class="matherr">`（浅灰底 + 原文），e-ink 上不再是黑块。
7. **工具调用**：连续 tool/result 合并成一个「工具 · N 次」面板，每条 160 字。
8. **热重载**：`index.js` 只挂 `hot.js`；`hot.js` 是稳定壳（配置/token/监听/鉴权/分发），每 250ms
   最多检查一次文件指纹（`app.js`/`generation`/`sessions`/`ui`/`markdown`/`math`/`prompt`/`account` + `prompt/kindle.md`
   的 size+mtime），变了就 `import('./app.js?gen=N')`。`app.js` 用同一 stamp 动态导入依赖，`ui.js`/
   `markdown.js` 再把 stamp 透传给 `math.js`，保证一次请求内模块同代。跨代共享放 `globalThis` 的 Symbol 槽：
   `Symbol.for('dsh-kindle.math')`（MathJax engine + SVG cache，按 `math.js` 自身哈希决定是否清 cache）、
   `Symbol.for('dsh-kindle.prompt')`（`WeakMap<agent,{text,undo}>`，重注册前先 undo）。新代加载失败保留旧代，
   错误写进 `/debug`；同一坏指纹不反复 import。

---

## 5. DSH Host API 速查（都已核实过签名，别再猜）

`ctx.sessionController`（`@deepseek-ai/dsh-api-session-controller`）：

| 方法 | 说明 |
| --- | --- |
| `create({cwd?, workspaceId?, sessionId?, agentPreset?})` | 返回 `{sessionId}` |
| `list({}, signal)` | `{items: SessionSummary[]}`；`projections.values.title` 是标题，`origin==='subagent'` 才是子代理 |
| `events({address:{kind:'session', sessionId}, throughSeq?, beforeSeq?, maxMessages?}, signal)` | 冷读历史分页（**不激活 Agent**）——本项目的消息来源。`records[].event` 才是事件；`maxMessages` 只数 user/assistant 消息（默认 50），`hasMore` 为真时用 `beforeSeq = 本页第一条的 seq` 往回翻，直到 seq 0 |
| `prompt({requestId, sessionId, mode:'queue'|'steer', content:[{type:'text',text}]}, signal)` | 返回 `{accepted:true}` |
| `follow({address, ...}, signal)` | AsyncIterable，第一帧 snapshot 带 `cursor` |
| `rename({sessionId, title})` / `fork({sessionId})` / `cancel({sessionId})` | fork 返回 `{sessionId}`，新会话 header 里带 `parentSession` |
| `selectModel({sessionId, provider, model, reasoningEffort?})` | 思考强度；返回 `{selected}` |
| `modelCatalog()` | 注意：真机默认 provider 的条目**不带 `reasoning`**，档位得问 `ctx.llm.resolveModelInfo` |
| `projections({sessionId}, signal)` | 当前选择在 key `modelSelection`，0.2.2 视图是 `{lastUsed, pending}`（0.2.1 是 `{lastUsed, next}`，插件两个都认） |

**0.2.1 → 0.2.2 的破坏性变化**：`inspect(sessionId, signal)` 已删除，换成 `events(request, signal)`；
`page()` 只是 `events()` 的废弃别名。插件 `sessions.ts` 优先用 `events()`，没有时回退 `inspect()`。

事件形状（踩过坑）：

- `user/message` 的 payload 是**平铺**的（`content`/`source`/`role`/`id` 直接在 data 上）。
- `assistant/message`、`system/message` 包在 `data.message` 里。
- 注入的 runtime-context、skill-catalog 也记成 `user/message`（`source.kind !== 'user'`），**必须过滤**，否则整页都是系统注入。

**所有方法都必须传 AbortSignal**（`AbortSignal.timeout(ms)`）：Host 实现里会调 `signal.throwIfAborted()`，不传就是 500 `Cannot read properties of undefined (reading 'throwIfAborted')`。

可选服务要用**子作用域**拿，别塞进 `inject`（缺服务会让整个插件不激活）：

```js
export const inject = ['sessionController']
// apply 里：
ctx.inject(['workspaceController', 'workspaceRegistry'], (scope) => { /* 读 scope.xxx */ })
ctx.inject(['llm'], ...)       // resolveModelInfo
ctx.inject(['accountController'], ...)  // 余额，未登录也不影响
```

`workspaceController.archiveSession({sessionId, stopActivity:true})` = 本项目说的「删除」；`workspaceRegistry.archivedSessionIds` 是 **Array**（不是 Set）。

---

## 6. Kindle 兼容性事实（实测，别按现代浏览器写）

- UA：`Mozilla/5.0 (X11; ; U; Linux armv7l; zh-cn) AppleWebKit/534.26+ (KHTML, like Gecko) Version/5.0 Safari/534.26+`
- 有：XHR、cookie、localStorage、`matchMedia`、内联 SVG、media query、`rem`。
- 没有：`fetch`、`Promise`、`EventSource`、flex、grid、`position:fixed`、`<img src="*.svg">`。
- 每个链接文字都强制下划线；滚动条常驻覆盖右侧；`<a>` 的 `float` 行为诡异，**布局不要用 float**。
- 整页加载约 3.5 秒，所以做增量 `/tail` 而不是整页 reload。
- 大写只能用 `input` 的 CSS，别指望 `text-transform` 以外的东西。

---

## 7. 历史坑清单（同样的坑别再踩）

| 症状 | 根因 |
| --- | --- |
| 页面一直是旧代码 | 0.3.0 前插件模块图不热更新、必须重启；现在 `lib/*.js` 与 `prompt/kindle.md` 下一次请求自动换代，只有 `index.js`/`hot.js`/配置仍需重启。判断依据看 `/debug` 的 `generation` |
| 生成中网页不刷新 | 内联脚本 `var` 里没声明 `jump`，`if(jump)` 抛 `ReferenceError`，整个 IIFE 直接退出 |
| 公式变黑块 | 只引了 base TeX 包，`\begin{pmatrix}` 报错输出 `merror` 红框 → 改用 `AllPackages` + `matherr` 兜底 |
| `\tag` 编号消失 | MathJax 的 tag 放在 SVG 之外，只取 `<svg>` 会丢 → `flattenTags` 把 `\tag{X}` 改写成 `\qquad\text{(X)}` |
| 删除 409 `cannot get property "workspaceController" without inject` | cordis 不允许读未声明服务 → 用 `ctx.inject([...])` 子作用域，别改 `inject` |
| 偶发“加载错误” | WebKit 复用已关闭的 keep-alive 连接 → 响应统一 `connection: close`，`keepAliveTimeout=1000` |
| 分叉 404 | 列表把「有 `parentSessionId` 的会话」全当子代理隐藏，而分叉会话保留 parent → 只过滤 `origin === 'subagent'`（0.2.1 修） |
| 消息重复/缺条 | 日志被 `surfaceOp: {op:'replace', startSeq, endSeq}` 改写，读日志时要先删区间再 push |
| 会话页空白、一直“生成中” | dsh 0.2.2 删了 `sessionController.inspect()`，插件调用抛 `inspect is not a function`，被页面兜底成空 transcript。改用 `events({address, beforeSeq, maxMessages}, signal)` 翻页（0.3.1 修） |
| 思考强度不跟随会话 | `modelSelection` 投影 0.2.2 改叫 `{lastUsed, pending}`，旧代码只读 `next` 就永远显示默认档（0.3.1 修，两个字段都认） |

---

## 8. 已知限制（当前刻意不做）

- 无流式：只有轮询，模型思考时页面是空的（有 `state` 徽标和「停止」）。
- 无图片/附件：用户传不了图，模型发的图也不显示。
- 草稿会丢：页面刷新/轮询 reload 时输入框内容不保留（轮询已经改成 append 所以大部分情况不 reload）。
- 删除 = 归档：文件还在磁盘上，Web GUI 里能恢复。
- 分叉没有确认页；分页只往回翻，默认 6 条一页。
- 余额只走**平台钱包**（`accountController`），不读 API key 的 `/user/balance`。
- 没有 `/fonts` 诊断页：会话页强制黑体（`SimHei` 等栈），真机万一落到宋体，目前只能靠加字体名试。

---

## 9. 待办与下一步建议

1. **真机核对分叉（0.2.1 引入）**：分叉应直接进副本页，列表显示「分叉：<原标题>」。本机已用 curl 验过（`fork → 303 → 200`），还没让用户在 KPW4 上点过。
2. **换 token**：当前 6 位 `kindle`，建议 `python3 -c "import secrets;print(secrets.token_hex(12))"` 写进 `/home/naroxeno/kindle-ws/.kindle-token` 并重新登录。学校内网穿透前必做。
3. **发布**：`PACKAGING.md` 已列 12 项对照，`npm pack` 16 文件 180 KB，`npm publish --dry-run` 通过；还差用户拍板三件事——包名（`dsh-kindle` 在 npm 上未被占用）、仓库地址、署名。`dshhub` 元数据已写好。
4. 可选：`/fonts` 诊断页；把 `spike/` 删掉或挪走（它的自检服务也占 8090）；给 `rename` 加长度/空值提示（已有 400）；分叉/删除加确认页。
5. 可选性能：`events()` 每次渲染按 200 条/页往回翻到 seq 0，会话很长（>200 条消息）时首屏要多次读取；可以改成先只取尾部，翻页链接再按需往前读。
6. **热重载真机验证**：2026-11-01 在真实 profile 上已验证——改 `src/` 构建后 `/debug` 的
   `hot: generation` 从 1 变 2（无需重启 dsh），会话页随之恢复。Kindle 设备端刷新一次确认即可。
   `test/hot-test.mjs` 继续覆盖临时副本上的全流程。

---

## 10. 交接时不要做的事

- 不要 `kill` 掉 `node /usr/sbin/dsh web`：它同时跑着 GUI 和所有 agent 进程，杀掉会中断正在进行的轮次（用户知道，但要提醒）。
- 不要把 `workspaceController` / `llm` / `accountController` 写进 `export const inject`：缺服务时整个插件不激活，Kindle UI 直接消失。
- 不要以为改 `inject`、`index.js`、`hot.js` 能热重载：这些是壳，必须重启 dsh（见第 2 节）。
- 不要靠 `kill` 进程来让代码生效：0.3.0 起改 `lib/*.js` / prompt 只需下一次请求；只有壳和配置才重启。
- 不要在 Kindle 页面上用 `fetch`/`Promise`/`flex`/`position:fixed`。
- 不要把真实 token、`.credentials.yaml` 内容写进仓库或文档。

---

## 11. 常用命令

```bash
# 测试
cd /home/naroxeno/main/kindle-dsh/bundle && npm test

# 单跑
node test/render-test.mjs
node test/server-test.mjs        # 起 127.0.0.1:8091
node test/integration-test.mjs   # 起 8092，真 cordis
node test/hot-test.mjs           # 起 8094，热重载全流程（临时副本，不碰真实 profile）
node test/browser-test.mjs       # 起 8093，需要 chromium

# 回放真实会话
node test/replay-test.mjs /home/naroxeno/.dsh/sessions/--home-naroxeno-kindle-ws--/<session>/session.v4.jsonl.zstd

# 真机侧检查
curl -s -c /tmp/kd.jar "http://127.0.0.1:8090/login?t=$(cat /home/naroxeno/kindle-ws/.kindle-token)" -o /dev/null -w '%{http_code}\n'
curl -s -b /tmp/kd.jar http://127.0.0.1:8090/debug
curl -s -b /tmp/kd.jar http://127.0.0.1:8090/s | head

# 打包
cd /home/naroxeno/main/kindle-dsh/bundle && npm pack
```

---

## 12. 版本历史（详见 bundle/CHANGELOG.md）

- 0.1.1 三个真机 bug：矩阵黑块、删除 409、偶发加载错误
- 0.1.2 增量刷新（`/tail`）
- 0.1.3 排版改版（大字、色条面板、工具合并）
- 0.1.4 会话页正文黑体
- 0.1.5 修 `jump` 未声明导致轮询完全不跑；加真 Chromium 回归
- 0.1.6 余额页 + 思考强度（档位改走 `llm.resolveModelInfo`）
- 0.2.0 打包成可发布插件（LICENSE/CHANGELOG/dshhub 元数据、干净 profile 验证）
- 0.2.1 修分叉 404，分叉自动改名
- 0.3.0 热重载：稳定壳 `hot.js` + 按代 `app.js`，`lib/*.js` 与 `prompt/kindle.md` 改动下一次请求生效；`/debug` 显示 generation/reloads/hot error；新增 `hot-test.mjs`
- 0.3.1 适配 dsh 0.2.2：会话消息改走 `sessionController.events()` 分页（`inspect()` 已删，保留回退）；思考强度改读 `modelSelection.pending`
