# 数据根下一个按内容寻址的插件仓

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#92](https://github.com/Myriad-Dreamin/penguin-harness/pull/92)

[English](2026-09-29-plugin-store.md)

一台机器收到的每个服务端插件，现在都另存一份在 `<数据根>/plugin-store/`，与索引仓库 penguin-plugins 的 `plugins/` 子树同构。目前没有任何代码从仓里加载：进程运行哪些插件、从哪里解析它们，都不变。

## 形状

- `<npm 名>/<版本>/<integrity 前 16 位十六进制>/` 一个条目，内含 `manifest.toml`（索引清单，含 `integrity`）、`package-lock.json`、`package/`（解开的包，依赖放在它自己的 `node_modules` 里）与 `.stored`（存入时间与来源）。
- `.stored` 最后写。没有它的条目视为不存在，同一内容下一次写入时替换它。
- `integrity` 是 `sha256-<hex>`，取 `package/` 以热推送的确定性归档器打包后、gzip 之前的字节。同一内容只存一份；同名不同版本、同版本不同内容各占一个条目。
- 每次写入后由树重建 `plugin-store/index.json`：与索引同一形状的平铺数组，每行带 `integrity`。

## 来源

- **热推送**：推送带来的每个内置插件在下一次启动时入仓。推送自身的前缀清单留在推送里，不成为条目。
- **构建**：安装物在程序旁自带的插件在每次启动时逐条目校 hash、缺则复制。在后台进行、只记日志，不会让启动失败。
- **registry**：在插件页安装插件时，先由 npm 取到 `plugin-store/.staging/<pid>/`，打包、算 hash、入仓，再执行原有的安装。hash 与索引条目所列不一致的包被拒绝，回 `400 plugin_store_failed`。索引条目目前还不带 `integrity`。
