# 通往机器的唯一入口：machines/transport/

- **Date:** 2026-09-01
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#567](https://github.com/Prism-Shadow/penguin-harness/pull/567)

[English](2026-09-01-machines-transport.md)

触达另一台机器的能力收进一个目录。`machines/exec.ts` 与 `machines/targets.ts` 变为 `machines/transport/exec.ts` 与 `machines/transport/targets.ts`，藏在 `transport/index.ts` 之后，并由一个扫描源码的测试把它们钉在那里。行为没有任何变化。

## 细节

- **这条规矩管的是权限，不是套接字数量。** 打开 ssh 就是本服务端对一台机器施加动作的全部方式，因此值得有一处地方拥有它，而不是每个调用点各自 spawn。自己开通道的调用点，随后也会用那条通道去判断机器的状态——而「我的 ssh 通了」和「那台机器是健康的」并不是同一个事实。把入口保持为单一，正是日后能把这两个事实分开讲的前提。
- **由源码扫描钉住**（`machines-transport-boundary.test.ts`），而不是靠约定：目录之外不得 spawn `ssh`/`scp`、不得越过 `transport/index.js`、也不得再按旧的顶层路径引用这些模块。它随测试套件在所有平台运行，失败时直接点名文件。测试自身豁免——私有模块的单元测试天然要引用它。
- **门后的东西预期会变。** index 现在导出的这些原始 runner 是安装路径当下所需；等到有了按机器的连接句柄，它们会收窄成那个句柄，而只从 index 引用的调用方不会察觉。
