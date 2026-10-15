# 更快的 CI 测试任务与固定的服务端 worker 池

- **Date:** 2026-10-15
- **Type:** process
- **Scope:** `ci`, `server`, `skills`
- **PR:** [#1158](https://github.com/Prism-Shadow/penguin-harness/pull/1158)

[English](2026-10-15-ci-faster-pipeline.md)

缩短了 CI 测试任务的耗时，并去掉了服务端测试在全部用例通过时仍会失败的一种情形。

## 细节

- Linux、macOS 与 Windows 的测试任务构建服务端时不再生成类型声明（`PENGUIN_BUILD_JS_ONLY=1`），任何测试都不读取它们；typecheck 与 npm 打包任务照旧生成。
- Windows 的服务端分片不再重复生成接口表：准备步骤里的服务端构建刚刚写过它。
- 完整运行时，浏览器与站点包（`web`、`ui`、`ui-gallery`、`docs`、`landing`）在 macOS 与 Windows 上单独成为 `sites` 分片，不再放在 `rest` 里。
- 运行时（runtime）任务把 electron-builder 下载的文件保存在 Actions 缓存中。
- 服务端的 Vitest 进程池保持两个 worker，并令 `minWorkers` 与 `maxWorkers` 相等。此前超出最小数量的 worker 会在空闲时被终止，可能在所有测试文件都通过之后以 “Terminating worker thread” 让整次运行失败。
- `penguin-harness-dev` skill 新增一节，说明 CI 时间是成本：Windows runner 上的单测时限、夹具规模、共享准备、新增分片的代价，以及检查 PR 的任务耗时。
