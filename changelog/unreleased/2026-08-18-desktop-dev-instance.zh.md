# 桌面端：开发运行可与已安装的发行版并存

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `desktop`, `docs`
- **PR:** [#318](https://github.com/Prism-Shadow/penguin-harness/pull/318)
- **Issue:** [#292](https://github.com/Prism-Shadow/penguin-harness/issues/292)

[English](2026-08-18-desktop-dev-instance.md)

未打包（源码）运行的桌面外壳——`pnpm desktop`，或 `pnpm --dir packages/desktop start`——取用带 dev 后缀的应用标识和独立的数据根目录，于是在源码上开发桌面应用不再与正在运行的安装版相撞。

## 开发实例

- 开发运行把应用名设为 `PenguinHarness-Dev`，由此获得独立的 userData 目录，随之而来的还有独立的 Chromium 配置、`preferred-port` / `server-port` 状态、Electron 单实例锁，以及——因为 Electron 的这几个路径都由 userData 推导——独立的 `logs`、`sessionData` 和 `crashDumps`。此前锁是共用的，发行版在跑时启动开发运行会立刻退回到发行版实例的窗口里，反过来也一样；开发运行还共用安装版的 Chromium 配置，并会覆盖其中记住的端口。
- 未打包时，数据根目录改由外壳自身默认到 `~/.penguin/dev-data`，而不再只由仓库根的 `pnpm desktop` 脚本设置：此前直接执行 `pnpm --dir packages/desktop start`，会在 `~/.penguin/data` 上发现安装版的 `server.lock`，把开发窗口挂到正在运行的发行版服务端上；发行版没在跑时，则会在发行版的数据上另起一个服务端。两种形式下显式的 `PENGUIN_HOME` 仍然优先。
- Windows 上的开发运行会打上带 dev 后缀的 AppUserModelID（`com.prismshadow.penguinharness.dev`），不再占用安装版在任务栏和通知上的标识。
- 崩溃与启动失败对话框改用 `app.name` 作标题，不再写死发行版名称，这样两个实例同时开着时，出问题的是哪一次运行仍然认得出来。
- 每次未打包启动都会打印它选中的这一组：`[shell] dev instance '<name>' on data root <root>`。
- 端口不需要新开关：内嵌服务端保持 `PORT=0` 分配、按 userData 记忆的做法，userData 目录一分开，各实例自然各有一个稳定端口。自动更新和 CLI 安装提示在未打包运行下本就不会出现。

## 发行版构建

发行版的行为没有变化——应用名、AppUserModelID、userData 目录，以及与 CLI 共享的数据根目录都照旧。为把这一点钉住，新增了两个单元测试：一个把发行版标识与 electron-builder.yml 中的 `productName`、`appId` 对齐，此前这只是一条写在注释里的约定；另一个固定数据根目录的优先级规则（显式 `PENGUIN_HOME` 最优先，其次是打包时取 CLI 根目录、未打包时取 dev 根目录），这条规则原先嵌在会 import Electron 的入口文件里，没法测。

## 兼容性

贡献者需要做一次性的调整，CONTRIBUTING.md 和安装文档中都已写明。此前直接执行 `pnpm --dir packages/desktop start` 跑在 `~/.penguin/data` 上，因此那样创建的会话不会出现在开发窗口里——若要刻意对着发行版的数据根目录工作，加上 `PENGUIN_HOME=~/.penguin/data`。另外 userData 目录随应用名一并搬了家，开发窗口按 origin 存储的偏好设置和记住的端口会重置一次。dev 标识是一个固定名称，而非每个工作副本一个，因此两份工作副本之间仍然共用同一把实例锁。
