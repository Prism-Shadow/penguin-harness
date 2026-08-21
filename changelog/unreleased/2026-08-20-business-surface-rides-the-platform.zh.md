# 整个业务面骑上了热更新平台

- **Date:** 2026-08-20
- **Type:** refactor
- **Scope:** `server`, `cli`, `desktop`
- **PR:** [#359](https://github.com/Prism-Shadow/penguin-harness/pull/359)

每一个业务服务和路由——从 `/api/me` 到 `/api/sessions`、调度器、会话管理器——都从 runtime 外壳
搬进了 platform：在 `platformImpl.create()` 里、基于 runtime 通过资源注册表发布的能力（数据库
句柄、认证服务、频道 hub、config、代理控制、桌面服务）组装，经 HTTP seam 对外服务。因此一次
热推送就能整体替换业务；runtime 只保留机制——传输、认证路由、HMR、静态托管。

## Details

- 原 `platform/` 目录解散进它的后继者：`hmr/`（交换机械与打包平台）、`app.ts`（两个面的组装）
  和 `terminal/`。
- 每个 App 注册一张路由表、作为一个整体发布自己，读者不可能观察到半交换的状态；未 park 状态的
  交换语义是硬停，终端作为 park 的例外跨代存续。
- 能力握手是结构化的：runtime 发布接口描述符（每个能力的成员集，外加 family），启动中的 platform
  在认领之前用声明校验活对象。
- 启动生命周期变为 `main()` 领衔的一步一方法的序列；CLI 与桌面端删去了 `resolveRoot()` 已经
  完成的一次多余 `PENGUIN_HOME` 读取。
