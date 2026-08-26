# 热更新失败不再把正在运行的 App 一起带走

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#408](https://github.com/Prism-Shadow/penguin-harness/pull/408)

[English](2026-08-23-hmr-teardown-transaction.md)

热更新有三条路径会让进程处于半死状态：还能靠闭包应答 HTTP，但 session manager、scheduler 与终端都已停止，除重启外无法恢复。三者形态相同——在能证明它成立的那一步成功之前，就先做了不可逆的动作——现在都把 swap 的 teardown 当作一次事务处理。

## 细节

- `upgrade()` 在「把失败转成可恢复结果」的块**之外**执行 dispose 与等待 drain。因此 disposer 抛错或 drain reject 会以 rejection 形式逃逸，而此时旧树已经倒下，调用方手里没有寄存文档，宿主的恢复路径也就从未执行。两步都移进块内：从旧树开始倒下的那一刻起，任何失败都会把恢复所需的文档交还。
- `bootNode` 先启动子节点、收集 `ctx.effect` 的 disposer，再执行实现的 `create()` 与方法集校验，任何失败路径上都没有 unwind。半途失败的节点会留下已启动的子节点与已登记的 effect，而没有任何东西能够触及它们——一个 watcher、一个退出监听器或一个子进程会泄漏至进程结束，且每次重试再叠加一份。现在它按成功 dispose 所用的同一「子节点优先」顺序 unwind。
- 平台把「本次构建无法承接的资源组」的销毁作为**第一个**动作，排在插件投递、业务面组装与 scheduler 启动之前——而这些都可能抛错。一个改变了资源声明、随后失败的 bundle 会把上一个 App 的终端一并带走，且宿主对旧 bundle 的重新启动也救不回来，因为恢复是按句柄重新认领的。现在的调和只**计算**各组的去向而不动手；认领时显式跳过将被销毁的组；销毁与声明覆盖推迟到 App 已经建好、再无可抛错之处时才执行。
