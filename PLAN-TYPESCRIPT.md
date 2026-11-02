# kindle-dsh：TypeScript 迁移方案（0.3.0 → 0.4.0）

- 状态：**已审计**（2026-10-30，修订见 §0.1）；M0–M5 已完成（M1 497deab、M2 96bcfa8、M3 d67edc6、M4 152c254、M5 7b5a92e）；0.3.1 基线与 DSH 0.2.2 适配见 §6.2
- 写于：2026-10-30
- 对象：`/home/naroxeno/main/kindle-dsh/bundle`（工作副本 0.3.1；M0 时为 0.3.0，tag `baseline-0.3.0`）
- 本文所有 `file:line` 指向当前工作副本；执行者开工前先确认这些行号还有效（用 `grep -n` 复核）

---

## 0. 这份文档怎么用

- **审计者**：只看 §4 决策、§6 类型骨架、§7 两道门，然后对 §9 的 Q1–Q6 逐条给结论。结论直接写回本文件（改成「已裁决」）或回复编号。
- **执行者**：先读本文 + `HANDOFF.md`，从 M0 开始；**每完成一个里程碑停下等验收**，不要一口气做完。
- 本文不包含实现代码，只有边界、顺序、验收和禁令。实现细节由执行者自己写，但不得越过 §1 的非目标与 §11 的禁令。

---

## 0.1 审计修订（2026-10-30）

- **M1 的「`git diff --stat lib/` 为空」撤销**：tsc 打印器固定改动格式（每层缩进 4 空格、每条语句补分号、删空行、去掉函数调用尾逗号），产物逐字节等于基线不可达。验收改为证明**语义与渲染输出等价**：去掉空白/分号/逗号后 7 个文件与 `baseline-0.3.0` 逐字符相同（实测仅 `app.js` 少 2 个尾逗号）、25 个渲染入口 sha256 逐字节相同、`npm test` 全绿、`check-dist` 通过。
- **`devDependencies` 破例收 `prettier`**：AGENT.md 第 4 条要求所有 `.ts` 过 Prettier，仓库里必须有能执行它的东西。prettier 只进 devDependencies，不进运行时、不进包；配置放 `bundle/.prettierrc`（无分号、单引号、2 空格、printWidth 100）。
- §2 是审计时的快照；M0/M1 已改掉它的版本控制（现有 git + tag `baseline-0.3.0`）与 typescript 安装状态。tsconfig 的 `target` 落成 `esnext`（`nodenext` 只适用于 `module`/`moduleResolution`）。
- §9 的 Q1（产物入库 + 一致性门）、Q2（壳留在 `lib/`）已按建议值执行（M1 落地）；Q3–Q6 到各自里程碑再定，偏离时回填裁决记录。

---

## 1. 目标与非目标

### 目标（只有三条）

1. 源码迁到 `src/*.ts`，编译产物仍是 `lib/*.js`（ESM）。包入口、`files`、运行时行为、HTTP 语义全部不变。
2. `ctx` 与它注入的服务、各渲染函数的入参，在编译期有类型；`any` 只允许出现在**唯一一处**动态 import 转换里（D6）。
3. 新增两道自动门：产物一致性门（`lib/` 必须等于重新编译的结果）、Kindle 兼容门（渲染输出不许出现设备跑不动的东西）。

### 非目标（本次明确不做，做了就是超出审计范围）

- 不换掉 `lib/hot.js` 壳，不接 `@deepseek-ai/dsh-hmr`。
- 不修 `dispose()`（`app.js:303` 是空实现）、不改 `?gen=N` 代数机制、不引入 `module.register` 钩子。
- 不改任何 HTTP 语义：路由表、`kd=` cookie、`/login?t=`、`/debug`、`connection: close`、`content-length`、`keepAliveTimeout`。
- 不改渲染输出：HTML 结构、CSS 规则、两处内联 ES5 脚本逐字节等价（`ui.js:350`、`ui.js:461` 的重复代码**不要**顺手合并）。
- 不加运行时依赖；不把渲染层搬进 `worker_thread`。
- 不动 `prompt/kindle.md` 的内容。
- 不做 `noUncheckedIndexedAccess` 这类会改动业务代码语义的严格化（见 Q4）。
- 不重构可选服务接入（见 §12，属 0.5.0 立项）。

### 为什么值得做（要解决的具体问题）

- 控制器方法名、返回字段全靠约定：`sessions.js` 调 `ctx.sessionController.*`，写错只在上线后 500。
- 渲染函数入参数是匿名对象（`ui.js:133` `renderLogin(config, next, options)`），字段拼错靠肉眼。
- 7 个模块 + 动态 import 的代数机制，混代没有任何静态检查能兜住（只能靠测试）。
- 反面边界：TS 解决不了「ESM 不可卸载」「dispose 空实现」「每代钉死 7 个模块记录」——那是另一个立项，本文不碰。

---

## 2. 现状事实（审计时逐条对照）

| 事实 | 位置 / 值 |
| --- | --- |
| 七个原始模块 | `lib/{app,sessions,ui,markdown,math,account,prompt}.js` |
| 两个手写壳（**不该被编译产物覆盖**） | `lib/index.js`（7 行，`index.js:14` `import { mount } from './hot.js'`）、`lib/hot.js`（19099 字节） |
| 换热文件清单 | `hot.js:43` `HOT_FILES = ['app.js','sessions.js','ui.js','markdown.js','math.js','account.js','prompt.js']` |
| 指纹算法 | `hot.js:117-119` 取 `stat` 的 `size:mtimeMs`；`CHECK_INTERVAL=250`（`hot.js:48`）、`FAILURE_BACKOFF=750`（`hot.js:50`） |
| 换代 specifier | `hot.js:172` `new URL('app.js?gen=N&t=<base36>', LIB)` |
| 兄弟模块同代 | `app.js:12` `STAMP = new URL(import.meta.url).search`；`app.js:25-29` 五个 `import('./x.js' + STAMP)` |
| dispose 空实现 | `app.js:303` `dispose() {}` |
| 跨代共享靠全局符号 | `math.js:27` `Symbol.for('dsh-kindle.math')`；`prompt.js:29` `Symbol.for('dsh-kindle.prompt')`、`prompt.js:31` `new WeakMap()` |
| 内联 ES5 脚本 | `ui.js:350`、`ui.js:461`（`var`/`function`/`try{}catch`，无箭头、无模板串） |
| 输出里无现代布局 | `grep -c 'display:flex\|display:grid\|position:fixed\|fetch(' lib/ui.js` = 0 |
| 依赖 | 只有 `asciimath-to-latex@0.5.1`（自带 `build/index.d.ts`）、`mathjax-full@3.2.2`（无 `types` 字段，但 `js/**/*.d.ts` 与实现同目录，nodenext 能解析） |
| 模块间依赖 | 除 `app.js` 的动态 import 外，只有 `math.js` 引第三方包；其余模块零相对导入 → 迁移顺序可任意，`app` 必须最后 |
| 版本控制 | `/home/naroxeno/main/kindle-dsh` **无 `.git`**（`git status` 报「不是 Git 仓库」） |
| 发布状态 | `npm view dsh-kindle` = 404，未发布 |
| 测试脚本 | `npm test` = render → server → hot → browser；`test/` 里另有 `integration-test.mjs`、`replay-test.mjs` **未入脚本**（见 Q6） |
| 基线（2026-10-30 实测） | `render-test`、`server-test` 通过；`browser-test` 需要 `chromium`（无则跳过）；`hot-test` 用 8094 端口 + 临时目录 |
| 类型包可用性 | `@deepseek-ai/cordis@4.0.5`（与 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis` 版本一致）、`@deepseek-ai/cordis-plugin-loader@1.0.6`、`@deepseek-ai/dsh-api-session-controller@0.1.2-alpha.2`（与安装的 rc.2 **不同代**） |
| 本机 | Node v26.11.1，npm 在线；`typescript` 未安装 |

---

## 3. 目标结构

```
bundle/
├── src/                    # 唯一手写源码目录（不发布）
│   ├── host.ts             # 边界类型：config / host / 控制器窄接口        [新增]
│   ├── generation.ts       # STAMP + load()，全仓唯一的动态 import cast 点 [新增]
│   ├── markdown.ts
│   ├── math.ts
│   ├── ui.ts
│   ├── account.ts
│   ├── sessions.ts
│   ├── prompt.ts
│   └── app.ts
├── lib/                    # 构建产物 + 两个手写壳
│   ├── index.js            # 手写壳，不编译、不覆盖
│   ├── hot.js              # 手写壳，不编译、不覆盖
│   └── {app,sessions,ui,markdown,math,account,prompt}.js   # tsc 生成
├── scripts/
│   ├── build.mjs           # 守卫 + tsc（M1）
│   └── check-dist.mjs      # 产物一致性门（M1）
├── test/
│   └── compat-test.mjs     # Kindle 兼容门（M5）
├── .prettierrc             # 格式约定（AGENT.md 第 4 条）
├── tsconfig.json           # 新增
└── package.json            # scripts / devDependencies 变化
```

`package.json` 变化（只这些）：

- `scripts.build` / `scripts.watch` / `scripts.check:dist`，`test` 前置 build + 两道门；
- `scripts.format` / `scripts.format:check`，只扫 `src/**/*.ts`；
- `devDependencies`: `typescript`、`@types/node`、`@deepseek-ai/cordis@4.0.5`、`prettier`（例外，见 §0.1）；
- `files` 保持不动（本来就不含 `src/`、`scripts/`、`test/`）；
- `main` / `exports` 保持 `lib/index.js`；
- `version` → `0.4.0`（Q5）。

---

## 4. 已定决策（请重点审这几条）

**D1 产物入库：`lib/` 由 tsc 生成，且提交进目录。**
理由：插件由 profile 直接从目录加载，没有安装期构建步骤，产物必须在目录里。
代价：`lib/` 不能手改。兜底 = §7 的产物一致性门 + build 脚本的壳守卫。

**D2 保留 `hot.js` 与 `?gen=N`，不接 `@deepseek-ai/dsh-hmr`。**
理由：hmr 换的是整个插件，HTTP listener 会拆掉重绑；那 200–500ms 空窗里 Kindle 一刷新就是连接失败，而 WebKit 534 不会优雅重试——`hot.js` 的 `clientError`、`connection: close`、`keepAliveTimeout=1000` 就是为此写的。维护「监听器与 cookie 跨代存活」优先于「少 200 行壳」。
替代被否：hmr 只在开发时开（可以，但那是 M7 独立立项，与本迁移解耦）。

**D3 两个壳不 TS 化（`index.js`、`hot.js` 留在 `lib/`，手写）。**
理由：壳存在的意义是「永远能跑」。让它依赖构建产物，等于把救生圈绑在船上。

**D4 两段式迁移：先 `src/*.js` 全量落位（allowJs，产物与基线语义等价、格式随 tsc 打印器，见 §0.1），再逐文件 `.js` → `.ts`。**
理由：先证明「tsc → lib/」这一步是无害的（可 diff、可回滚），再引入类型。每一步都有现有测试兜底。

**D5 类型来源：`@deepseek-ai/cordis@4.0.5` 取 `Context`/`Plugin`/服务装饰器；控制器接口手写成窄接口放 `src/host.ts`，不依赖 `dsh-api-*` 的 alpha 包。**
理由：安装的 DSH 是 `0.2.1-rc.2`，npm 上 API 包是 `0.1.2-alpha.2`，跨代类型给的是**假保证**；本插件只用到十来个方法，窄接口可读、可审、可随 DSH 升级手改。真实的兼容门是 `server-test` + 真机，不是类型。
替代被否：`tsconfig.paths` 指到 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/...`（绑死本机路径，换机器就废）。

**D6 动态 import 只在 `src/generation.ts` 一处 cast。**
`app.ts` 不再自己拼 5 个 `import(...)`，改为：

```ts
// src/generation.ts
export const STAMP = new URL(import.meta.url).search
export interface Generation {
  sessions: typeof import('./sessions.js')
  math: typeof import('./math.js')
  ui: typeof import('./ui.js')
  prompt: typeof import('./prompt.js')
  account: typeof import('./account.js')
}
export async function load(): Promise<Generation> {
  const [sessions, math, ui, prompt, account] = await Promise.all([
    import('./sessions.js' + STAMP),
    import('./math.js' + STAMP),
    import('./ui.js' + STAMP),
    import('./prompt.js' + STAMP),
    import('./account.js' + STAMP),
  ])
  return { sessions, math, ui, prompt, account } as unknown as Generation
}
```

理由：非字面量 specifier 拿不到类型，必须 cast 一次；放在一个文件里，审计时只看这一处。`Generation` 用 `typeof import(...)` 让类型随模块自动更新，不会漂移。

**D7 测试一律对 `lib/`（产物）跑，不对 `src/` 跑。**
理由：测的不是发布物等于没测；`hot-test` 本来就是复制 `lib/` 到临时目录跑的。

**D8 版本 0.4.0，CHANGELOG 记「重写为 TypeScript，运行时行为不变」。**
不升 minor 的理由：没有 API/行为变化；升 patch 的理由：源码布局变了，值得一个可辨识的版本。

---

## 5. 类型边界（审计骨架，只到字段级）

`src/host.ts` 至少包含：

```ts
export interface KindleConfig {
  host: string; port: number; token: string; cwd: string
  fontSize: number; pageSize: number; hotReload: boolean
}
export interface KindleLogger { info?: (m: string) => void; error?: (m: string) => void; warn?: (m: string) => void }
export interface KindleServices {           // 只写本插件真正用到的成员
  sessionController: SessionControllerLike
  workspaceController: { deleteSession?: (id: string) => Promise<unknown> } | null
  workspaceRegistry: unknown | null
  llm: unknown | null
  accountController: AccountControllerLike | null
}
export interface KindleHost {
  ctx: { sessionController: SessionControllerLike }   // app.js 读 ctx.sessionController
  config: KindleConfig; services: KindleServices
  auth: { token: string; hash: string | null }; logger: KindleLogger
  hot?: () => KindleHotStatus                          // /debug 读 generation/reloads
}
```

控制器窄接口从**实际调用点**反推（执行者不得凭想象补方法）：

- `sessions.js`: `listSessions` / `createSession` / `sendPrompt` / `renameSession` / `forkSession` / `archiveSession` / `cancelSession` / `sessionState` / `readTranscript` / `modelCatalog` / `modelChoice` / `setReasoningEffort`；另需 `resolveAgent`（`prompt.js:55`）
- `account.js`: `readAccount`（`account.js:32`）
- 工作区删除：`workspaceController.archiveSession`（`sessions.js:134`，参数 `{ sessionId, stopActivity: true }`）

`src/app.ts` 的 `createApp(host: KindleHost): Promise<KindleApp>`；`src/hot.js` 传进来的对象是 `any`（壳不 TS 化），在 `app.ts` 边界一次 `as KindleHost`，理由与 D6 同。

渲染函数：`renderSession(config, view)` 这类先写 `interface SessionView`，在 `app.ts` 构造处用 `satisfies SessionView` 校验，避免「先写类型再改实现」的大改。

---

## 6. 两道门

### 6.1 产物一致性门 `scripts/check-dist.mjs`（M1 引入）

1. `tsc -p . --outDir .dist-check`（临时目录）；
2. 对 `src/` 里每个模块，逐字节比较 `.dist-check/<name>.js` 与 `lib/<name>.js`；
3. 断言 `lib/index.js`、`lib/hot.js` 存在，且 `src/` 里**不存在**同名文件（防有人把壳也编译了）；
4. 有差异 → 打印第一个不匹配文件的 `diff` 片段并 `exit 1`。

`scripts/build.mjs` 在跑 tsc 之前断言 `lib/hot.js` 与 `lib/index.js` 存在（防止有人 `rm -rf lib` 后构建出一个跑不起来的包）。

### 6.2 Kindle 兼容门 `test/compat-test.mjs`（M5 引入）

对渲染函数喂代表性 view（登录、列表、会话、预览、账户），断言输出：

1. 不含 `<script src`、`type="module"`、`import(`；
2. 抽取每个 `<script>...</script>` 正文，断言不含 `=>`、`?.`、`??`、`let `、`const `、`` ` ``（反引号）、`async `（内联脚本必须 ES5）；
3. 不含 `display:flex`、`display:grid`、`position:fixed`、`fetch(`；`XMLHttpRequest` 是 WebKit 534 唯一可用的异步请求方式（会话页 `runTail` 依赖它），**允许出现**；
4. CSS 全部内联在 `<style>`（无 `<link rel="stylesheet"`）；**不要求** `<meta name="viewport"`——0.3.x 的 `shell()` 只输出 `<meta charset="utf-8">`，加 viewport 会改变全部页面输出，超出本次迁移范围，另立项处理；
5. 公式只落内联 `<svg`，不含 `<img`、不含 `<math`；
6. 每个 `<form>` 都有 `method="post"` 与 `action`；无 `method="get"` 的提交按钮；
7. 响应头断言（放在 `server-test`）：**只对 HTML 页面**断言 `content-length` 存在且 `cache-control` 明确；`connection: close` 由 `lib/hot.js:335` 对所有响应统一设置，断言一次即可。`/tail`、`/state`、`/debug` 的 JSON/text 是 chunked、无显式 `content-length`，不在断言范围。

这 7 条逐条对应真机上的具体故障（白屏、点了没反应、连接失败、公式不显示），执行者不得删减。第 3、4、7 条按 2026-11-01 的 0.3.1 实现与实测响应修正，修正理由见下。

**0.3.1 基线补充（2026-11-01）**：另一会话已把会话读取迁到 DSH 0.2.2 的 `sessionController.events()`（提交 `1b011e5`），`bundle/package.json` 随之为 0.3.1，`dsh.compatibility` 仍为 `>=0.2.1-rc.1 <0.3.0-0`，`dshReleases` 增加 `0.2.2-alpha.2: compatible`。0.4.0 以此提交为起点，M2/M3 的边界类型与事件分页逻辑不再重做。

---

## 7. 里程碑（每步验收 + 回滚）

### M0 基线（约 30 分钟）

- `git init`（当前无仓库！），`.gitignore` 排除 `node_modules/`、`.dist-check/`；
- `git add -A && git commit -m "baseline 0.3.0" && git tag baseline-0.3.0`；
- 记录 `npm test` 完整输出到 `docs/baseline-0.3.0-test.log`；记录 `node -v`、`npm -v`；
- **验收**：`git log` 有一个提交、tag 存在、`git status` 干净；测试输出里 4 个脚本都出现过。
- **回滚**：删 `.git` 即可，不影响现有文件。

### M1 构建骨架（约 1 小时）

- `cp lib/{app,sessions,ui,markdown,math,account,prompt}.js src/`；
- 写 `tsconfig.json`（`module`/`moduleResolution=nodenext`、`target=esnext`、`rootDir=src`、`outDir=lib`、`allowJs=true`、`checkJs=false`、`strict=false`（M4 再开）、`skipLibCheck=true`、`verbatimModuleSyntax=true`、`isolatedModules=true`、`sourceMap=false`）；
- `npm i -D typescript @types/node @deepseek-ai/cordis@4.0.5 prettier`；
- 写 `scripts/build.mjs`、`scripts/check-dist.mjs`，接进 `npm test` 首位；
- **验收**：`npm run build` 后产物与 `baseline-0.3.0` 语义等价（去空白/分号/逗号后逐文件相同）、25 个渲染入口指纹不变；`npm test` 全绿；`check-dist` 通过。（「`git diff lib/` 为空」已撤销，理由见 §0.1）
- **执行记录**：2026-10-30 完成，提交 `497deab`；tsc 7.0.2，渲染指纹 25/25 一致，`npm test` 全绿。
- **回滚**：`git checkout -- lib/ && rm -rf src scripts tsconfig.json`。

### M2 边界类型（约 1 小时）

- 写 `src/host.ts`、`src/generation.ts`（此时 `.ts`，内部 import 仍指向 `./x.js`）；
- **验收**：`npx tsc --noEmit` 无错；`npm test` 全绿；`generation.ts` 里只有一处 `as unknown as Generation`。
- **执行记录**：2026-10-30 完成，提交 `96bcfa8`；`npx tsc --noEmit` 干净，`npm test` 全绿，`generation.ts` 只一处 cast；`lib/host.js`（`export {};`，11 B）与 `lib/generation.js` 入库。
- **偏差（M3 前必须记住）**：
  1. `tsconfig.json` 增 `"types": ["node"]`：TS 7.0.2 原生编译器不自动加载 `@types/node`，`node:http`/`node:fs` 报 TS2591（`--traceResolution` 显示 `Skipping module 'node:http' that looks like an absolute URI`），加 `types` 后消失。
  2. `generation.ts` 保留 §5 的 `STAMP` 写法，但 **M3 必须由 `app.ts` 用带 `?gen=` 的 URL 动态 `import('./generation.js' + STAMP)`，并把 `generation.js` 加进 `lib/hot.js` 的 `HOT_FILES`**；若改为静态 import，`import.meta.url.search` 为空，五个兄弟模块失去按代隔离（M2 尚无消费者，未触发）。
  3. 接口按实际调用点落地：`workspaceController` 的方法是 `archiveSession`（非 §5 原写的 `deleteSession`）；`sessionController` 另需 `resolveAgent`（`prompt.js:55`）；`workspaceRegistry.archivedSessionIds` 按 `Iterable<string>` 收；`llm.resolveModelInfo` 供思考强度补全。
  4. `lib/host.js` 只有 `export {};`：check-dist 要求 `src/` 每个模块都有同名产物，接受这个 11 字节空模块。
- **回滚**：删两个文件。

### M3 逐文件转 TS（约 3–4 小时，可分批）

顺序：`markdown` → `math` → `ui` → `account` → `sessions` → `prompt` → `app`。

- 每个文件：改名 `.js`→`.ts`，补类型，不加行为；
- `math.ts` 的 MathJax 装配段**不改**，只补类型（`mathjax-full` 的 d.ts 与实现同目录，若个别签名不匹配，用局部 `// @ts-expect-error` 并注明原因与行号，不许 `any` 铺开）；
- 每转完一个文件跑一次 `npm test` + `check-dist`；
- **验收**：`git diff` 里没有输出字符串变化（`lib/*.js` 的 HTML 片段逐字节相同）；`npx tsc --noEmit` 干净。
- **执行记录**：2026-10-30 完成，提交 `d67edc6`。7 个文件依次转换，每个文件单独跑 `npx tsc --noEmit` + `npm test`；最终 `npm test` 全绿、`check:dist` 通过、`prettier --check "src/**/*.ts"` 干净。
- **接线与偏差**：
  1. `app.ts` 用 `const generation = (await import('./generation.js' + STAMP)) as { load(): Promise<Generation> }` 换代（落实 M2 偏差 2）；`generation.js` 已加进 `lib/hot.js` 的 `HOT_FILES`，`hot.js` 只改这一个列表项。
  2. `ui.ts` 唯一行为改动：原 `const buttons = model.efforts.map(...)` 后接 `buttons += ...`，tsc 报 TS2588，改为 `let buttons`。这不只是编译问题——「部署默认 effort 不在 adapter 列表」分支原本会在运行时抛 `TypeError`（此前从未执行过该分支），现在能正常显示当前档位。
  3. `sessions.ts` 的 `setHost` 用 `const store: Record<string, unknown> = host` 逐 key 写（union key 的交叉写入要求）；`data.message` 用 `as SessionMessage` 收口。
  4. `SessionView` 增可选 `updatedAt`/`version`（app 传、ui 不读），避免对象字面量 excess property 报错。
  5. 注释按 AGENT.md 第 1 条删除；脚本剥注释时把 `ui.ts` 内联脚本里的两行 `//` 注释也当成源码注释删了（它们其实是页面里的 JS，位于模板字符串内）。与 `baseline-0.3.0` 逐字节比对渲染输出时抓到，已补回。
- **验收（实际做的）**：用 `git archive baseline-0.3.0 bundle/lib` 取基线 `lib/`，与当前 `lib/` 分别渲染 markdown×2 + 会话/列表/登录/账户/改名/删除/预览/消息共 10 份输出，`diff` 为 `RENDER-IDENTICAL`；`npx tsc --noEmit` 干净。
- **回滚**：单个文件 `git checkout -- lib/<name>.js src/<name>.ts`；整体 `git revert d67edc6`。

### M4 关 allowJs、开 strict（约 1 小时）

- `allowJs: false`、`strict: true`；修掉 `noImplicitAny` 与 `strictNullChecks` 的真题；
- **验收**：`npx tsc --noEmit` 干净；`npm test` 全绿；`grep -rn ': any' src/` 只剩壳边界那一处（`app.ts` 的 `as KindleHost` 不算 `any` 标注）。
- **执行记录**：2026-10-30 完成，提交 `152c254`。`tsconfig.json` 改为 `allowJs: false`、`strict: true`（删 `checkJs`）；首轮报 27 个错，集中在 `app.ts`（12）、`sessions.ts`（8）、`account.ts`（3）、`math.ts`（2）、`ui.ts`/`prompt.ts` 各 1。修完后 `npx tsc --noEmit` 干净，`npm test` 全绿、`check:dist` 通过、`prettier --check` 干净。
- **修法与偏差**：
  1. `catch (error)` 在 strict 下是 `unknown`：`app.ts` 加本地 `errorText(error: unknown)`，其余文件就地 `(error as { message?: unknown } | null)?.message || error`。对 `Error`/字符串/`null` 的输出与旧表达式逐字相同。
  2. `app.ts` 的 `logger.error(...)` 在 `host.ts` 里是可选方法：改为 `logger.error?.(...)`。这是 `ui.ts` 的 `buttons` 之后第二个「旧代码在缺 logger 时本来会 500」的隐患，正常 Host 下无行为变化。
  3. `sessions.ts` 的 `setHost`：`Object.keys(partial)` 断言为 `Array<keyof KindleServices>`，绕开 `Partial` 无索引签名；写入仍是逐 key `|| null`。
  4. `sessions.ts` 的 `modelChoice`：把 `resolved.efforts` 拆成 `resolvedEfforts` 局部量（strict 不会跨 `&&`/`Array.isArray` 保留窄化），语义不变；`modelCapabilities` 把 `undefined` 归一成 `null`。
  5. `account.ts`/`ui.ts` 的 `wallets` 在 `ok: true` 下仍声明为可选：用 `|| []` 兜底，真实 `readAccount` 路径不变；`math.ts` 的 `engine()` 要求 `doc` 与 `adaptor` 同时存在，`amToTex` 改为先取局部再赋值。
- **验收（实际做的）**：`npx tsc --noEmit` 干净；`grep -rn ': any' src/` 无输出（比计划更严：连壳边界也没有 `any` 标注）；`npm test` 全绿；重跑 M3 的渲染比对脚本，10 份输出仍全部 `RENDER-IDENTICAL`。
- **回滚**：改回 `strict: false, allowJs: true`。

### M5 兼容门（约 1 小时）

- 写 `test/compat-test.mjs`（§6.2 七条），接进 `npm test`；
- **验收**：7 条断言全过；故意写一条违规（如临时把 `display:flex` 塞进 ui.ts）能被拦住，然后撤回。
- **执行记录**：2026-11-02 完成，提交 `7b5a92e`。新增 `test/compat-test.mjs`（登录/列表/会话/预览/账户 5 个页面），按 §6.2 修正口径断言第 1–6 条；第 7 条在 `test/server-test.mjs` 对列表、会话、改名、删除、账户 5 个 HTML 页面断言 `content-type`、`cache-control: no-store`、`connection: close`、`content-length` 与响应体字节数一致。`npm test` 全绿。
- **违规注入验收**：把 `lib/ui.js` 复制到 `/tmp/kindle-gate-check`，将首个 `display:block` 改成 `display:flex` 后跑 compat 门，退出码 1，报 `AssertionError: 登录: 含 display\s*:\s*flex`；仓库内文件未改，避免运行中的 hot shell 换代。
- **回滚**：删文件、还原 `test` 脚本。

### M6 收尾（约 1 小时）

- 版本 → 0.4.0；CHANGELOG 加一节；README / PACKAGING 补「源码在 `src/`，`lib/` 由 `npm run build` 生成，勿手改」；HANDOFF 更新「改代码流程」；
- `npm pack --dry-run` 确认包里没有 `src/`、`scripts/`、`test/`；
- **验收**：`npm pack --dry-run` 文件清单只比 0.3.0 多/少预期项；`npm test` 全绿。
- **回滚**：文档与版本号单独一个 commit，可单独 revert。

### M7（可选，不阻塞本次交付）hmr spike

- 独立分支/独立文档；判定标准：改 `lib/ui.js` 后 `hmr/reload` 是否真的重挂插件、旧实例的 `ctx.effect` 清理是否执行、listener 是否被重建。
- 结论只有两种：「能替代 hot.js」/「不能，理由 X」。不进 0.4.0。

---

## 8. 风险

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | 无 git 仓库，迁移途中没有回滚锚点 | 高 | M0 强制 `git init` + tag；M0 未完成不得开工 |
| R2 | 有人 `rm -rf lib` 或手改 `lib/*.js` | 高（包直接跑不起来） | build 脚本守卫 + 一致性门 + 文档写明 |
| R3 | 控制器类型与真实 DSH 漂移（alpha 包跨代） | 中 | 窄接口只覆盖实际调用；`server-test` 用假控制器 + 真机 `/debug` 验证 |
| R4 | tsc -w 写入半截文件被 hot shell 加载 | 低 | `hot.js` 已有失败保留上一代 + 750ms 退避；不要在请求密集时改代码 |
| R5 | 迁移顺手改了输出（合并重复内联脚本、改 CSS） | 中 | `git diff` 逐字节比对 `lib/*.js` + 兼容门 |
| R6 | `mathjax-full` d.ts 与运行时签名不符 | 中 | 局部 `@ts-expect-error` + 注释；禁止全局 `any` 铺开 |

---

## 9. 需要审计者裁决的 6 件事

- **Q1 产物入库**：接受 `lib/` 是生成物并提交进目录吗？（建议：接受 + 一致性门）
- **Q2 壳的位置**：`index.js`/`hot.js` 留在 `lib/`，还是移到 `shell/` 再被 `files` 带进包里？（建议：留 `lib/`，改动最小，`files` 不用动）
- **Q3 类型来源**：控制器窄接口（建议）还是 devDep 上 `dsh-api-*` 包？（两者可并存，但不要都上）
- **Q4 严格化程度**：`strict: true` 到此为止，还是加 `noUncheckedIndexedAccess`？（建议：不加，会逼着改业务代码）
- **Q5 版本号**：0.4.0 还是 0.3.1？（建议 0.4.0，源码布局变了）
- **Q6 测试清单**：`integration-test.mjs`、`replay-test.mjs` 要不要补进 `npm test`？（建议：本次不补，先让迁移期测试稳定；补的事单独立项）

裁决后，把本文 §9 的对应条目改写成「已定：…」，再交给执行者。

---

## 10. 执行者禁令（越界即返工）

1. 不接 `@deepseek-ai/dsh-hmr`，不改 `hot.js`/`index.js` 的任何逻辑（改也不行，哪怕只是格式化）。
2. 不改 HTTP 语义、路由、鉴权、响应头。
3. 不改渲染输出的 HTML/CSS/内联脚本（含那两段重复的内联脚本，不许合并）。
4. 不加运行时依赖；`devDependencies` 只允许 `typescript`、`@types/node`、`@deepseek-ai/cordis`、`prettier`（prettier 为审计破例，见 §0.1）。
5. 不把 `any` 铺开；`as unknown as` 只能出现在 `generation.ts` 与 `app.ts` 的 host 边界。
6. 不跳过 M0 的 git 基线；不一次做完所有里程碑。
7. 不做 `worker_thread`、`module.register`、`dispose` 回收等「顺手改造」。

---

## 11. 开发者工作流变化（迁移后的日常）

- 改代码：`src/*.ts` → `npm run build`（或常开 `npm run watch`）→ `lib/*.js` 更新 → **下一次请求 hot shell 自动换代**，`/debug` 的 generation 加一。
- 格式化：`npm run format`（Prettier，仅 `src/**/*.ts`；没格式化过的 `.ts` 视为未完成），核对用 `npm run format:check`。
- 需要重启的情况不变：改 `index.js`、`hot.js`、`cordis.patch.yml`，或升级安装。
- 排查「改了没生效」：先 `npm run check:dist`，再看 `/debug` 的 generation 有没有涨。

---

## 12. 后续立项：可选服务与第三方插件接入（0.5.0 候选，不在本次范围）

**动机**：每个人的运行环境不同——装的 DSH 插件不同，能提供的服务也不同。现在 `hot.js` 把三条可选服务写死（`hot.js:247` workspaceController+workspaceRegistry、`hot.js:261` llm、`hot.js:272` accountController），`services` 里用 `null` 表示缺失，渲染层各自判空。三条还能读；十条就是一堆样板 + 判空散进七个 render 函数。

**目标结构（表驱动 + 能力查询）**

- 每个可选集成一个文件 `src/integrations/<name>.ts`，导出 `{ id, requires: ['服务名'], attach(ctx, services) }`；它需要的窄接口写在这个文件里（沿用 D5，不信 alpha 类型包）。
- `hot.js` 改成循环 `INTEGRATIONS` 逐个 `ctx.inject(it.requires, scope => …)`。
- 渲染层不许直接碰 `ctx`/`services`，只问 `has('account')` 这类能力判断；降级规则集中在集成表里声明（哪些路由/行在缺失时隐藏），不散进七个 render 函数。
- 单个集成 `attach` 抛错：标记它自己 unavailable + `logger.warn`，页面照常渲染。

**机制依据（不要自己造）**

- cordis `ctx.inject(deps, cb)`：依赖缺失时不给回调、不报错；服务撤走时触发 `scope.effect` 清理。现有 `hot.js:247-279` 已经是这个语义，只是硬编码了三条。
- 所以「晚到 / 撤销 / 换人」都交给运行时；集成代码**不要缓存服务引用**，每次从 host 读。

**接入一个新插件时的检查单**

1. 新建 `src/integrations/x.ts`：只有 `requires`、`attach`、窄接口。
2. 注册进 `INTEGRATIONS`。
3. 渲染层只加能力判断，不读 `ctx`/`services`。
4. 加「缺失态」测试：不装该插件时页面完全可用（`server-test` 的假控制器可扩）。
5. 更新该目录的 `README.md`（AGENT.md 第 2 条）。

**明确不做**：不做自动发现（遍历 `ctx` 猜能力）——不可审计，且会随 DSH 升级乱掉；不为「将来可能接的插件」提前写空壳（AGENT.md 第 3 条）。

**时机**：等第一个真实需求（第三个可选服务）出现再做，那时接口形状才有依据。此改动必须动 `hot.js`，所以只能排在 0.4.0 稳定之后，单独立项。
