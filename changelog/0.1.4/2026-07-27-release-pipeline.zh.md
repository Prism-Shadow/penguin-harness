# 发布流水线：一个只会在要紧之处失败的版本测试

- **Date:** 2026-07-27
- **Type:** fix
- **Scope:** `ci`, `server`
- **PR:** [#97](https://github.com/Prism-Shadow/penguin-harness/pull/97), [#99](https://github.com/Prism-Shadow/penguin-harness/pull/99)

[English](2026-07-27-release-pipeline.md)

`packages/server/test/version.test.ts` 把 `/api/version` 的响应体断言为 `{ version: VERSION, buildDate: null }`。版本号来自 core 的常量；而构建日期是一个硬编码字面量——而 `null` 只有在源码构建下才成立。发布工作流**在构建与测试之前就会把这两个常量打戳**：`VERSION` 取自 tag，`BUILD_DATE` 取该次运行的 UTC 日期。于是这条断言在每一次普通 CI 运行中成立、在每一次本地运行中成立、在构建 tarball 的 `release` 任务中也成立（它根本不跑测试），而只在恰好一个地方失败——`publish-npm` 任务的构建并测试步骤，也就是发往 registry 之前的那道闸门。

v0.1.3 遇到的正是这件事。它的 GitHub Release 完整发布了：全部 15 个产物、史上第一个 `penguin-win32-x64.zip`、`install.ps1`。而 npm 链路从未启动，registry 上的 `@prismshadow/penguin-{skills,core,server,cli}` 停留在 0.1.2。这两个任务在设计上就是独立且并行的——这是一项刻意的性质，好让 registry 故障不至于赔上一次 Release——但这同时也意味着一次绿色的 Release 对 npm 什么都说明不了，而这个缺口在有人专门去查之前是不可见的。

该断言现在把 `buildDate` 与 `BUILD_DATE` 相比较，也就是端点所提供的同一个常量，因此它对打过戳的发布构建与源码构建同样成立，而端点的契约仍被端到端固定住。v0.1.3 这个 tag 无法移动去捡起这个修复——仓库的受保护 tag 规则禁止这样做——因此 0.1.4 成了投递载体：对任何从 npm 安装的人来说，正是这个版本承载了 0.1.3 的全部功能集。
