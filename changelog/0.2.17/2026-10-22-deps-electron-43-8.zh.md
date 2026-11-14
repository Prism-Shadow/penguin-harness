# 依赖：Electron 43.8（11 条安全公告；Node 24.22，Chromium 150.0.7871.250）

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1292](https://github.com/Prism-Shadow/penguin-harness/pull/1292)

[English](2026-10-22-deps-electron-43-8.md)

桌面壳的 Electron 从 43.2.0 升到 43.8.3：版本范围改为 `^43.7.6`，pnpm 将其解析为发布已满一天（其
发布期限下限）的最新 43.x。由此关闭了针对 Electron 43.2.0 的 11 条 Dependabot 告警。内置的 Node.js 从 24.18.0 升到
24.22.0，Chromium 从 150.0.7871.129 升到 150.0.7871.250。Electron 大版本仍为 43，因此应用打包的
node-pty 二进制没有重新编译。

## 细节

- 关闭的安全公告。高危：GHSA-qmv3-fv6v-rmhq（被攻破的渲染进程可污染沙箱 preload 的代码缓存）、
  GHSA-9qh4-3jw8-366w（`<webview>` 可在 Web Worker 中开启 Node.js 集成）、GHSA-j84w-jfhq-vhvj（file
  与 HTTP 协议处理器允许跨源读取）、GHSA-gr2m-v5gq-v685（从沙箱文档打开的窗口不继承其沙箱限制）。
  中危：GHSA-fw47-9c62-h3vw、GHSA-997q-gvvc-jwmx、GHSA-x562-297c-g43g（权限请求被归到错误的源或
  frame）、GHSA-2p8c-gr87-2676（从链接打开的窗口未应用 SameSite Cookie 限制）。低危：
  GHSA-h3v5-h239-pg29、GHSA-3qxv-5xgr-q7w9、GHSA-98mx-cjp9-gchm。
- 这一区间里与桌面壳相关的上游修复：内嵌 server 以 `utilityProcess` 运行，此前子进程退出前刚写出的输出
  可能丢失（43.7.6 修复），退出前经 `process.parentPort.postMessage()` 发出的消息也可能丢失（43.8.0）；
  子进程退出后再调用 `utilityProcess.postMessage()` 不再崩溃，Windows 11 24H2 及以后的 utility 进程
  退出时也不再崩溃（43.5.0）。Network Service 进程重启后，更新器的 `net.fetch` 不再永久以
  `net::ERR_FAILED` 失败（43.8.0）。
- `pnpm-lock.yaml` 中只有 `electron` 条目变化；electron-builder 26.16.1 与 electron-updater 6.8.9
  保持不变。
