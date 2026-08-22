# Windows CI 作业拆分为两个测试分片

- **Date:** 2026-08-21
- **Type:** process
- **Scope:** `ci`
- **PR:** [#385](https://github.com/Prism-Shadow/penguin-harness/pull/385)

[English](2026-08-21-ci-windows-speed.md)

把 `ci-windows` 拆成两个并行分片,并去掉了与平台无关门禁重复的步骤,Windows 侧墙钟时间约减半;每个包的测试在 Windows 上仍然恰好各跑一次。

## 详情

- `server` 分片单独运行 server 包的套件——进程开销最大的套件独占整台 runner——并承担 PowerShell 安装脚本解析与 Windows 安装器测试。
- `packages` 分片先单独运行 core 的套件(其 `exec_command` 测试会真实拉起 shell 并在超时内读取输出,在超订阅的 runner 上会输掉竞态),再一并运行其余六个包。
- 去掉了 Windows 上的 `typecheck` 步骤:tsc 的结果与平台无关,由 ubuntu 作业守门——与该作业对 `format:check` 已有的处理同理。
