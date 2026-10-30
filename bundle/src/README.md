# src

`src/` 是唯一手写源码目录。`lib/` 里除 `index.js`、`hot.js` 两个壳外都由 `npm run build` 生成，**不要手改 `lib/*.js`**。

2026-10-30 起 7 个模块全部是 `.ts`（M3 完成，见仓库根 `PLAN-TYPESCRIPT.md`）。源码默认零注释（仓库根 `AGENT.md` 第 1 条）；需要解释的外部约束写在这里或同目录 `AGENT.md`。

- 构建：`npm run build`（tsc → `lib/`）；`npm run watch` 常开。
- 产物一致性：`npm run check:dist` 重新编译到 `.dist-check/` 并逐字节比对 `lib/`。
- `index.js`、`hot.js` 两个壳不在本目录、不参与编译；`npm run build` 前会检查它们还在。

几点容易踩的：

- **模板字面量内的 HTML/CSS/内联脚本就是运行时输出**，不是注释：删注释时不要把里面的 `//` 行当源码注释删掉；改完用 `npm test`，必要时拿 `baseline-0.3.0` 的 `lib/` 做渲染比对（做法见 PLAN M3 执行记录）。
- **代际**：`app.ts` 只能动态 `import('./generation.js' + STAMP)`，`generation.js` 必须留在 `lib/hot.js` 的 `HOT_FILES` 里；改成静态 import 会让 `import.meta.url.search` 变空，兄弟模块失去按代隔离。
- **类型边界**：`host.ts` 是控制器窄接口，不引 `dsh-api-*` 类型包；`generation.ts` 与 `app.ts` 的 host 边界是唯一允许 `as unknown as` 的地方。
- `lib/` 是生成物：`git diff lib/` 的注释增删是正常的（tsc 不保留源码注释），但 HTML 字符串必须与基线一致。
