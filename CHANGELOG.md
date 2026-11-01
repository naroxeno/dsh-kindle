# Changelog

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
