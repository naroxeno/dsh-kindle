# 打包评估与发布准备（dsh-kindle）

> 结论：**可以发布**。包本身、元数据、文档、许可证都已就绪；剩三个需要你拍板的决定
> （npm 包名、仓库地址、版权署名）和一个动作（`npm publish`）。

## 一、什么叫"可发布的 DSH plugin"

按本机已发布的 bundle（`dsh-cost-meter`、`dsh-free-search`、`dshmarket`）归纳，一个能
让 `dsh plugin --profile <p> add <包名>` 装完就用的包需要满足：

| 项 | 要求 | 现状 |
| --- | --- | --- |
| 包形态 | `type: module`、`exports["."］`、`dsh.bundle.patch` 指向包内 patch | ✅ |
| 激活方式 | 装进 profile 后写进 `dsh.profile.bundles`，包自带 patch 里 `insert` 一行 | ✅ |
| 配置覆盖 | 用户在自己的 `cordis.patch.yml` 里用 `- id:` 覆盖（`config` 整体替换） | ✅ 已验证 |
| 兼容声明 | `engines.dsh` + `dsh.compatibility.dsh` + `dshReleases` | ✅ 本次补上 |
| 市场元数据 | `dshhub`（displayName / summary / categories / surfaces / permissions） | ✅ 本次补上 |
| 许可证 | `license` 字段 + LICENSE 文件 | ✅ 本次补上（MIT） |
| 文档 | 包内 README（安装 / 配置 / 安全 / 限制） | ✅ 本次重写 |
| 变更记录 | CHANGELOG | ✅ 本次补上 |
| 版本一致性 | 运行时报的版本 = package.json 版本 | ✅ 本次加测试锁住 |
| 无私有依赖 | 只依赖公共包 | ✅ `mathjax-full`、`asciimath-to-latex` |
| 无本机痕迹 | 不含自己的 IP / token / 会话 id | ✅ 扫描过 |

技术上还有两条硬要求，都已满足：插件只 import **node 内置模块**和两个公共包，dsh 自带
的能力全部通过 `ctx.*` 取（`sessionController` / `workspaceController` / `accountController` /
`llm`），所以不需要 `peerDependencies`，也不会被 dsh 的版本升级卡住。

## 二、这次改了什么

1. **package.json 补全**：`license: MIT`、`keywords`（含 `dsh-plugin`，市场按这个检索）、
   `os`、`engines.dsh`、`dsh.compatibility`、`dshhub`、`publishConfig.access: public`，
   去掉 `private: true`，版本 `0.1.6 → 0.2.0`（首个公开版）。
2. **LICENSE / CHANGELOG**：MIT 正文；CHANGELOG 记录 0.1.1–0.2.0 每一版修了什么。
3. **包内 README 重写**：与原仓库里那份"我自己的运行记录"分开——包内这份是给用户看的，
   不含本机 IP / token / 会话 id，含安装、配置覆盖写法、安全警告、已知限制、`/debug` 说明。
4. **`docs/` 三张截图**进包（会话页、列表页、账户页），README 里直接引用。
5. **修了一个真问题（0.1.6 遗留）**：思考强度档位原来从 `modelCatalog()` 取，但
   deepseek adapter 的目录条目**不带 `reasoning` 字段**，所以真机上「思考」这一行根本不显示。
   改为向 `llm.resolveModelInfo(provider, model)` 问这个路由支持哪些档位
   （`off/low/high/max`），目录只作兜底；档位文案中文化（关 / 低 / 高 / 最大）。
   在干净 profile 里实测 `/debug` 已从 `(no reasoning)` 变成 `(off,low,high,max)`。
6. **版本一致性测试**：`render-test` 断言 `VERSION === package.json.version`，避免发布时
   出现"装的是 0.2.0、`/debug` 说 0.1.6"。

## 三、怎么验证的

不是"应该能装"，是实际装了一遍：

1. `npm pack` 出 tarball：**16 个文件 / 176 KB**（不含测试、不含 node_modules）。
2. 在 `/tmp/dsh-scratch` 建了一个**干净 profile**（`kindle-test`，从 web 模板复制）：
   ```
   DSH_HOME=/tmp/dsh-scratch dsh plugin --profile kindle-test add /tmp/dsh-kindle-0.2.0.tgz
   ```
   → pnpm 装包、自动写进 `dsh.profile.bundles`，`--dump-config` 里出现
   `- id: kindle-ui / name: dsh-kindle / config: {...}`。
3. 启动该 profile（GUI 换到 3181 避免撞正在跑的 3080）→ Kindle 端 8099 正常响应，
   `/debug` 输出 `kindle-ui 0.2.0`、`account (balance): ready`、
   `model catalog: deepseek-official/deepseek-flash (off,low,high,max)`。
4. 覆盖配置验证：在 profile 的 `cordis.patch.yml` 写 `- id: kindle-ui` + 自定义
   `port: 8099 / fontSize: 28 / pageSize: 4` → `--dump-config` 里新值生效
   （注意：该文件初始是 `[]`，要整个换成列表，不能往 `[]` 后面追加——README 已写清）。
5. `npm test` 四套全绿（渲染、HTTP 26 项、真 cordis 集成 7 项、真 Chromium 轮询）。
6. `npm publish --dry-run` 通过（只提示未登录，符合预期）。

## 四、需要你决定的

1. **包名**：`dsh-kindle` 在 npm 上还是空的（`npm view` 返回 404），可以直接用。
   想加 scope 就用 `@<你的 npm 名>/dsh-kindle`，安装要同时给 scope。
2. **仓库地址**：`repository` / `homepage` / `bugs` 三个字段我留空了——没有 GitHub 地址
   就不要写假的。有仓库了我补上（市场展示、源码链接都靠它）。
3. **版权署名**：LICENSE 现在写的是 `Copyright (c) 2026 naroxeno`，要换成真名/组织名告诉我。

## 五、发布动作（你来执行，或授权我做）

```bash
cd /home/naroxeno/main/kindle-dsh/bundle
npm login                     # 一次性
npm publish                   # 之后每次改版本再发
```

发布后别人的安装方式就是：

```bash
dsh plugin --profile web add dsh-kindle      # 或插件界面里填包名
```

想进社区市场，再给
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提个
PR（只要仓库地址和一句话简介）。

## 六、风险与注意

- **依赖体积**：`mathjax-full` 安装时下载约 9 MB、解压后约 45 MB；装完不联网。想瘦身可以
  只保留 `tex-svg.js` 需要的子集，但会牺牲"任意 LaTeX 都能渲"的能力，暂不值得。
- **兼容范围**：在 dsh `0.2.1-rc.2` 与 `0.2.2-alpha.2` 上验证过，声明 `>=0.2.1-rc.1 <0.3.0-0`。
  0.2.2 把 `sessionController.inspect()` 换成了 `events()`（0.3.1 已适配，并保留旧 API 回退）；
  dsh 进入 0.3 时要重新验证。
- **默认端口 8090**：和别人冲突时改配置即可，不要把默认值改成随机端口——Kindle 上输入
  地址越短越好。
- **安全**：token 等于 Host 的 shell 权限，README 已用粗体写明，并建议 frp 纯 HTTP 穿透、
  不要用强制 HTTPS 的隧道。
- **`token: off`**：关掉鉴权时启动日志有 warn，但公网暴露就是灾难，README 只建议本机使用。
- **余额**：走平台钱包（`accountController`），不是 API key 的 `/user/balance`；未登录平台
  时 `/me` 显示"读不到"，不影响其他功能。

## 七、0.3.0 增量（热重载，2026-10-29）

- **代码结构**：`lib/index.js` 变成 823 B 的薄壳；新增稳定壳 `lib/hot.js`（19.1 kB，HTTP 监听/鉴权/
  按文件指纹换代）与可热重载代 `lib/app.js`（15.0 kB，原路由整体搬入）。改 `lib/*.js` 或
  `prompt/kindle.md` 后，**下一次 HTTP 请求**即换新代码；端口、监听、token、cookie 都不变。
- **`npm pack` 刷新**：18 个文件 / 186.3 KB（0.2.0 是 16 个 / 176 KB；0.2.0 的 index.js 约 26 kB）。
- **新增测试**：`test/hot-test.mjs`（临时副本里改 ui/math/prompt、写坏语法、手动换代、空闲不换代），
  已进 `npm test`；`integration-test` 的版本正则改成接受任意 `x.y.z`。
- **版本一致性仍由 `render-test` 锁住**（`VERSION` 读 package.json）。
- **仍需重启一次的边界**：`lib/index.js`、`lib/hot.js`、`cordis.patch.yml` 或升级安装本身属于
  「壳」，只有重启 dsh 才会加载；重启之后才进入免重启循环。0.2.0 的验证流程（干净 profile /
  8099 / `--dump-config`）对 0.3.0 仍适用，重启后 `/debug` 第二行应出现
  `hot: generation 1 (0 reloads, auto on)`。
