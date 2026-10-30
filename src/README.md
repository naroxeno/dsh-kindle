# src

`src/` 是唯一手写源码目录。`lib/` 里除 `index.js`、`hot.js` 两个壳外都由 `npm run build` 生成，**不要手改 `lib/*.js`**。

迁移期：这里先是 0.3.0 的 7 个模块原样拷贝（`.js` + `allowJs`，先证明 tsc 到 `lib/` 这一步不改变行为），之后逐文件改成 `.ts` 并补类型。原文件注释随迁移保留，转 `.ts` 时按仓库根 `AGENT.md` 第 1 条处理。

- 构建：`npm run build`（tsc → `lib/`）；`npm run watch` 常开。
- 产物一致性：`npm run check:dist` 重新编译到 `.dist-check/` 并逐字节比对 `lib/`。
- `index.js`、`hot.js` 两个壳不在本目录、不参与编译；`npm run build` 前会检查它们还在。
