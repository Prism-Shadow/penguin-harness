# server 启动时报出 web dist 路径,并拒绝还原缺少 index.html 的 web 版本

- **Date:** 2026-08-29
- **Type:** fix
- **Scope:** `server`, `desktop`
- **PR:** [#547](https://github.com/Prism-Shadow/penguin-harness/pull/547)

[English](2026-08-29-web-dist-diagnostics.md)

静态文件无物可服时,server 对每个页面都答 404,却什么也不说。三处修改把这个状况点出来。

## 细节

- 启动时在 `Data root:`、`SQLite:` 旁边打印 `Web dist: <path>`,该目录没有 `index.html` 时发出警告——错误的 `PENGUIN_WEB_DIST` 或缺失的 `packages/web` 构建现在会出现在日志里,而不是只表现为一个光秃秃的 404。
- 打包的桌面应用把内嵌 server 钉到自己的 `web-dist`(`PENGUIN_WEB_DIST`,显式设置的值仍然优先),并在 fork 之前检查其中的 `index.html`;没带 web 资源的构建现在会在启动时报错并给出路径,而不是打开一个 404 的窗口。源码运行不钉任何值,保留 server 回退到 `packages/web/dist` 的行为。
- 还原持久化的热推版本时,要求存储的 web dist 包含 `index.html`,与推送时的底线一致。缺少它的存储文件会让还原失败,并以常规的 `persisted version failed to restore` 警告点名该文件,随后改为提供打包的 web dist,而不是一个处处 404 的内存版本。
