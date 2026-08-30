# 用 `--dev` 把已安装的桌面版作为第二个隔离实例启动

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `desktop`, `docs`
- **PR:** [#544](https://github.com/Prism-Shadow/penguin-harness/pull/544)

[English](2026-08-29-desktop-dev-profile.md)

桌面壳的 dev 隔离——`PenguinHarness-Dev` 身份及其独立的 userData 目录、单实例锁和记忆端口,以及默认的 `~/.penguin/dev-data` 数据根——改为由命令行开关选择的 **profile**,不再是"未打包运行"的副作用。已安装的 release 版加 `--dev` 启动即取该 profile,于是同一份安装可以并排跑两个实例:release 实例在 `~/.penguin/data`,第二个在 dev 根上,互不可见。未打包运行(`pnpm desktop`)仍默认 dev profile;`PENGUIN_HOME` 在两个 profile 下都仍然覆盖数据根。

## 细节

- `--dev` 按进程参数精确匹配;`--dev=…` 和 `--dev-tools` 都不算。Windows 上推荐的启动方式是复制一个快捷方式,目标末尾加 `--dev`。
- `--dev` 实例运行的是已安装 release 自身的代码。它用于在没有源码的情况下对着另一套数据使用应用,不是用来跑未提交修改的。
- dev profile 下更新器一律停用(`unsupported`,原因 `dev`),无论是否打包:它要替换的安装属于 release 实例,而后者可能正在旁边运行。
- 每次启动对捆绑 `penguin` 命令链接的修复只在 release profile 上进行,共用的安装因此只有一个 owner。
- `[shell] dev instance '<name>' on data root <root>` 启动行对每个 dev profile 启动都会打印,打包与否无关。
- dev 的 AppUserModelID 没有对应的已安装快捷方式,所以 `--dev` 实例的 Windows 通知可能不渲染;release 实例不受影响。
