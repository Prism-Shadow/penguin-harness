# Benchmark 写入与 Chrome 重连的竞态，以及更轻的服务端测试夹具

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `ci`
- **PR:** [#1151](https://github.com/Prism-Shadow/penguin-harness/pull/1151)

[English](2026-10-15-ci-flake-races.md)

修复了两处让 CI 随机失败的竞态，去掉了让服务端测试在 Windows 与 macOS runner 上慢了数倍的夹具负担，并让服务端测试不再遗留临时目录。

## 细节

- 同一进程向同一 Project 的 `benchmarks/` 写入 Benchmark 时逐个进行。此前同一 id 的两次覆盖若相互交错，可能把被移开的旧副本永久留在 `.seeding/` 下；一次写入结束时也可能删掉另一次正要在其中暂存的 `.seeding/`。现在同时发出的多次覆盖按发出顺序依次落地。
- Chrome 扩展的连接只在连接监听器（其中包括刷新标签页列表）执行完之后才算已连接。重连过程中读取状态，不会再报告浏览器可用、却给出断开之前的标签页列表。
- 服务端测试：`createTestApp` 创建的 Project 默认不写入内置 Benchmark，场景需要时以 `builtinBenchmarks: true` 显式开启。此前每个测试应用、每个预置用户写下的文件大多是它们。生产环境照旧写入，经由新的 `BuiltinBenchmarkSeeds` 接口。
- 终端提示符钩子的场景先等到 trap 的输出，再输入下一条命令；Web 的表单提交与原生 title 检查对每个文件只解析一次，并跳过不可能含有目标内容的文件。
- 服务端测试不再遗留临时目录：此前一次完整运行会在系统临时目录下留下 130 个目录（6,559 个 inode），多次运行后曾占满一台共享机器的 `/tmp`。`makeTempRoot()` 创建的目录若测试文件自己没有删除，会在该文件结束时删除；启动失败的应用会删除自己的目录；浏览历史、Chromium 配置目录与终端相关的场景会在自己的进程和定时器结束后再清理。每次运行现在都写在自己的目录下，运行结束时报告其中残留的条目（`[temp] N temporary entries outlived the tests that made them`）并删除该目录。core 的 shell-resolver 场景也会删除自己的目录。
