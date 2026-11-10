# Changelog

## Unreleased

修会话页「翻历史被弹回最新」。

- 生成中打开会话、点「更早的消息」不再整页滚到页底：只有发送后（`?fresh=1`）才跳到底部，其余整页加载不动视口。
- `/tail` 请求带 `&n=` 保持当前窗口，`replace` 不会把已展开的历史塌回默认 6 条；不在页底时先不落 `replace`，继续轮询，回到底部再同步。
- 轮询响应解析失败改为延迟重试，不再 `location.reload()`。
- 列表页头部压成一行：搜索、搜索按钮、「＋ 新会话」并排，去掉整条黑底新建按钮；「生成中」「空会话」改成「●」小点加文字，不再反白。

## 0.6.1 — 2026-11-09

安全补强，不改界面结构。

- 登录 token 换成 32 字符随机串（`randomBytes(24).base64url`），旧的 6 位 `kindle` 作废。轮换 `.kindle-token` 后下一次请求即生效，不用重启：`createApp` 在鉴权前把 `host.auth` 同步成新哈希，旧 `kd` cookie 立刻失效。登录 cookie 加 `SameSite=Lax`。
- 文件页（`/files`、`/f`、`/t`、`/i`、`/img`）加独立 6 位密码，默认 1 小时。密码只存 scrypt 哈希（`.kindle-files-pin`），解锁 cookie 是 HMAC 签名的过期时间（密钥 `.kindle-files-key`，0600，自动生成）；连错 5 次锁 60 秒。
- 新增 `scripts/set-files-pin.mjs`，一条命令重设文件密码；新增 `scripts/set-token.mjs`，写 `.kindle-token` 并 touch `lib/app.js`，下一次请求重载生效（只手工改文件不会触发代次）。
- server-test 增加 PIN 门：未解锁拦截、错码提示、正确码 303 + cookie 后放行。

## 0.6.0 — 2026-11-09

这一版把「文件」做成只读文件管理器，并清掉 Kindle 上所有依赖滚动、锚点才能完成的交互。

### 文件

- `/files` 改成目录浏览器：默认从工作区根开始，目录在前、文件在后，各自按名称排序；顶部灰色
  面包屑可逐级点回，另有「‹ 上一级」。`p=` 传目录，`s=` 保留会话上下文，返回回到进来处。
- 打开方式按类型分派：`.md` 走 `/f` 排版页；图片走 `/i` 看图页（`/img` 出原图，上限
  12 MB）；文本走 `/t` 等宽页（`pre-wrap` 自动折行，上限 1 MB）；其余只列大小与时间，标
  「不能预览」。
- 没有扩展名的 `LICENSE`、`Makefile` 以前被当二进制拒掉。现在读头 8 KB 判断：有 NUL 或非法
  UTF-8 才算二进制；已知图片、压缩包扩展名跳过嗅探。`/t` 用同一套判断，改错扩展名也拦得住。
- 长 Markdown 顶部生成三级以内的目录。Kindle 不吃 `#` 锚点，点条目整页重载 `?at=<块号>`，
  服务端从该标题开始渲染，附「显示全文」。
- 会话里的相对链接不再 404：Markdown 链接、裸路径、行内代码里的文件名统一解析，能读到就按类型
  生成 `/f`、`/t`、`/i` 链接，读不到只留文字。
- Markdown 的表格表头、反引号配对这些老问题一并修了。

### 会话与设置

- 页面里不再有贴视口底部的元素（Kindle 会因此划不动）。列表去掉分页与底栏，一屏到 60 条连续滚动。
- 发送后重定向 `?n=2`，打开会话默认 6 条（`OPEN_WINDOW`），「更早的消息」按窗口增长；回复框
  留在会话页末尾，顶部条带不再放跳转按钮。
- 思考强度四格移到回复框下；生成中显示状态条与「■ 停止生成」。
- 设置页新增「排版」：会话正文、文章与文件分别开关 2em 段首缩进（文章默认开），另有工作区筛选。
- 账户页隐藏 0 值赠送余额与缓存说明。

### 测试

server-test 覆盖目录浏览器（子目录、面包屑、上一级）、文本嗅探（`LICENSE` 可读、`.bin` 拒绝）、
图片页、目录跳转，以及原有防线（越界 403、非 Markdown 400、不存在 404）。

## 0.5.0 — 2026-11-06

标题栏多了「峰时 / 谷时」价签，和余额并排。按 DeepSeek 的峰谷计价规则在本地算，不额外请求接口。

- **规则**（北京时间）：周一至周五 9:00–12:00、14:00–18:00 是高峰，其余时段——含周末和法定
  节假日全天——是空闲；空闲单价是高峰的一半。见官方
  [模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。
- **节假日表**在 `src/account.ts` 的 `HOLIDAYS`，现收录 2027 年（国办发明电〔2026〕10号，
  2026-11-05 发布）。每年 11 月补下一年；缺年份只会把那一年的节假日误标成峰时。
- **外观**：谷时是描边小标签，峰时反白（黑底白字）。价签跟着 `toolBar` 出现在首页、会话页、
  设置页、账户页这些有右侧动作的页面，登录和错误页不显示。
- `/debug` 多一行 `price: 谷时（空闲价，单价是高峰时段的一半）`。
- 测试：server-test 增加六组时点（上午、下午、午休、18 点后、周六、春节）的价签断言，以及
  列表页价签与 `/debug` 行检查。
- README 与 `src/account.ts` 注释写明为什么价签在本地算：账户接口没有价格字段，cost-meter
  的峰谷设置也只在自己进程里，没有给其他插件的查询接口。

## 0.4.0 — 2026-11-06

Kindle 建的会话不再掉进 GUI 的「未分组」：建会话前先解析或注册工作区，再用 `workspaceId`
让 Host 自己 `attachSession`。新增 `/settings` 页（默认工作区、旧会话归组）与列表页搜索框。
兼容契约、热重载路径都没动，`npm test` 全绿。

- **分组根因**：`session.create({cwd})` 只在 Host 里建会话，不会挂到任何 Workspace，GUI 因此
  显示「未分组」。现在 `POST /new` 先 `workspaceRegistry.resolveByPath(cwd) ?? create(cwd)`，
  再 `create({workspaceId})`；分叉沿用 Host 的 `forkWorkspace`，自动留在同一组，不用改。
- **默认工作区**：新 `/settings` 页可填目录（支持 `~/x`）或点已有工作区切换。选择存在
  `<config.cwd>/.kindle-settings.json` 的 `{"workspace": …}` 里——`config.cwd` 只在改配置重启
  时变，所以文件位置稳定；之后列表、创建、归属校验、`/img` 根目录都以它为准。
- **旧会话归组**：切到某个目录时，页面显示「N 个旧会话」；保存设置会顺手把同目录的旧会话
  `attachSession`，也可以单独点「把 N 个旧会话归组」。
- **搜索**：列表页加标题搜索框（子串、大小写不敏感、60 字截断）。表单仍只 POST：`POST /s`
  收到 `q` 后 303 到 `/s?q=…`，翻页与「清除搜索」都带着 `q`。
- **/debug** 多三行：当前工作区、workspace 服务是否注册、设置文件路径。
- 测试：compat 增加设置页视图（7 个）；server-test 换成临时工作目录并把 workspace mock 做成
  真实体，增加分组建会话、设置页、搜索、保存、归组 5 项检查；integration-test 增加真实
  cordis 下「传 `workspaceId` 而不是 `cwd`、会话被挂到工作区」的检查。

## 0.3.2 — 2026-11-06

界面按 Kindle 原生观感与触摸操作重做，`bundle/src/ui.ts` 基本重写。兼容契约不变
（无 `display:flex`/`grid`/`position:fixed`、内联脚本只用 ES5、表单只 POST），`npm test` 全绿。

- **触摸尺寸**：1 CSS px = 1 物理 px @300ppi，旧版 40–60px 的按钮只有 3–4mm 高。交互件改为
  90–110px；UI 标签从 0.5em（≈4pt）提到不小于 0.82em。
- **列表页**：整行 `<a class="row">` + `›` 箭头，标题 serif、时间与徽标下一行；行内的
  「分叉 / 改名 / 删除」小按钮撤掉，操作统一收到会话页动作条。
- **会话页**：双层页头（工具条 + 页标题）、4 格动作条（分叉 / 改名 / 删除 / ✎ 输入，跳到
  `#composer`）、思考强度改成分段控件 `关 / 低 / 高 / 最大`（每格独立 `form`）。
- **消息**：1px 描边改 10px 色条 + 底色（u 黑条灰底、a 白条、tools 灰条），Markdown 样式
  收进 `.msg .body`。
- **输入区**：整行大按钮（发送 / 预览公式 / 停止生成，104px 高）；公式盘 6 列 0.56em →
  4 列 0.86em、每键 92px。
- **错误页**：新增 `ui.renderError()`，`app.ts` 的 `renderErrorPage` 改为调用它，替换掉原来的
  内联极简 HTML。
- 文档：`docs/` 截图重拍（新增 preview）；README 排版一节重写。

## 0.3.1 — 2026-11-01

适配 dsh `0.2.2-alpha.2`（`sessionController.inspect()` 已被 `events()` 取代）。

- **会话页空白 / 一直“生成中”**：0.2.2 删掉了 `inspect(sessionId, signal)`，插件调用时抛
  `inspect is not a function`，被页面兜底成「还没有内容」。现在改读
  `events({address, beforeSeq, maxMessages}, signal)`，按 `hasMore` 向前翻页直到 seq 0；
  老 Host 上仍然回退到 `inspect()`，0.2.1 不受影响。
- **思考强度不跟会话走**：`modelSelection` 投影在 0.2.2 里是 `{lastUsed, pending}`（旧版是
  `{lastUsed, next}`），插件只读 `next` 所以永远显示默认档。现在两者都认。
- 测试：假 Host 换成 `events()` 分页接口（每页最多 2 条消息，强制走翻页）、投影换成
  `pending`，并新增「切换档位后页面显示当前档」断言；`replay-test.mjs` 用真实日志跑分页读取，
  顺带修好它自 M3 起没再调用 `setHost` 的问题。

## 0.3.0 — 2026-10-29

热重载：改完 `lib/*.js` 或 `prompt/kindle.md` 后，下一次 HTTP 请求就用新代码，**不用重启 dsh**。

- **稳定壳 + 按代替换**：`lib/index.js` 只负责挂载；`lib/hot.js` 是跨代不变的壳（配置、token、HTTP
  监听、登录与鉴权、请求分发）；真正的路由与页面在 `lib/app.js`，以 `app.js?gen=N` 动态导入。
  文件指纹（size + mtime，250ms 节流）变化时在前一个请求结束后换新代，并释放上一代。
- **依赖同代一致**：`ui.js` / `markdown.js` 用 `import.meta.url` 的 query 作为 stamp 动态导入
  兄弟模块，保证一次请求里所有模块都来自同一代，不会新旧混用。
- **跨代状态不丢**：MathJax 实例与 SVG 缓存、按 agent 的提示词注册（WeakMap + undo）放在
  `globalThis` 的 Symbol 槽里；`prompt/kindle.md` 改动后先撤销旧段再注册，避免
  `prompt section "…" is already registered`。
- **坏文件不拖垮服务**：新代码加载失败时继续服务上一代，错误显示在 `/debug`；同一坏指纹不反复
  重试。`GET /debug?reload=1` 可手动换一代。
- 配置新增 `hotReload`（默认 `true`，设成 `false` 恢复“改完重启才生效”）。`index.js` / `hot.js` /
  `cordis.patch.yml` 的改动仍需要重启（壳本身不能热替换）。
- `/debug` 顶部新增 `hot: generation N (R reload(s), auto on|off)` 与失败时的 `hot error: …`。
- 新增 `test/hot-test.mjs`：在临时副本上起真服务，逐项验证 ui.js 编辑、ui→markdown→math 依赖链、
  prompt/kindle.md 重注册、语法错误降级、修复恢复、手动刷新与空闲不误重载。

## 0.2.1 — 2026-10-29

修复：

- **分叉返回 404**：列表把「有 parentSessionId 的会话」全部当成子代理隐藏了，而分叉出来的
  会话既继承 cwd 又保留 parentSessionId，于是重定向到 `/c/<新 id>` 后判定为「不在 Kindle
  工作区里」。现在只隐藏 `origin === 'subagent'` 的会话，分叉的照常列出。
- 分叉后自动把副本改名为「分叉：<原标题>」，列表里不再出现两行同名会话。

测试：HTTP 用例新增「分叉页 200」「子代理会话不出现在列表」，并让假 Host 的 `list()`
像真实 Host 一样返回 `parentSessionId` / `origin` —— 修之前的代码会在这两项上失败。

## 0.2.0 — 2026-10-23

首个公开发布版本。此前 0.1.0–0.1.6 只在本机安装使用。

功能：

- 服务端渲染的 Kindle 页面（列表 / 会话 / 登录 / 改名 / 删除 / 账户 / 公式预览），
  不依赖前端框架，面向 WebKit 534（Kindle Paperwhite 4，固件 5.14.2）实测可用。
- 公式：输入用 AsciiMath（`$...$`），发送前转成 LaTeX 交给模型；显示用服务端
  MathJax SVG（内联，像素几何在服务端算好）；带 `\tag` 编号与渲染失败兜底。
- 会话管理：新建、续聊、分页、改名、分叉、删除（归档）、增量刷新（轮询）。
- 账户：平台钱包余额（列表页一行 + `/me` 页），读不到时不影响使用。
- 思考强度：会话页按模型能力显示 关 / 低 / 高 / 最大，切换即 `selectModel`。档位来自
  adapter 的 `resolveModelInfo`，因为模型目录对部分 adapter 不返回 `reasoning`。
- 每个 Kindle 会话注入一段「阅读端」系统提示词（短答、不用表格、公式只写 LaTeX）。
- 认证：登录链接带一次性 `?t=` token，种一年期 HttpOnly cookie；token 缺失时
  自动生成并写入 `<cwd>/.kindle-token`。

测试：`npm test` 四套（渲染、HTTP、真 cordis 集成、真 Chromium 轮询回归）。

## 0.1.6 — 2026-10-22

- 新增余额页与会话页思考强度切换。

## 0.1.5 — 2026-10-22

- 修复增量刷新在真机上完全不跑（内联脚本引用未声明变量，WebKit 抛出 ReferenceError）。
- 新增真 Chromium 回归用例 `test/browser-test.mjs`。

## 0.1.4 — 2026-10-22

- 会话页正文改用黑体（标题仍衬线），其余页面保持衬线。

## 0.1.3 — 2026-10-22

- 排版改版：大字、左侧色条消息面板、工具调用合并、全宽主按钮、可用性导航。

## 0.1.2 — 2026-10-22

- 会话页改为增量刷新（`/c/:id/tail` + 片段追加），不再整页 reload。

## 0.1.1 — 2026-10-21

- 修复矩阵/带编号公式渲染成黑块（MathJax 只挂了 base 包，缺 ams）。
- 修复删除会话 409（cordis 禁止读取未 inject 的 workspace 服务）。
- 修复偶发加载错误（keep-alive 连接复用 + 读到半个 JSON 行）。
