# 用 `--dev` 把已安装的桌面版作为第二个隔离实例启动

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `desktop`, `server`, `core`, `docs`
- **PR:** [#544](https://github.com/Prism-Shadow/penguin-harness/pull/544)
- **Breaking:** yes — dev profile 数据根里的机器记录描述的是那些机器上的 release 安装，不做转换

[English](2026-08-29-desktop-dev-profile.md)

桌面壳的 dev 隔离——`PenguinHarness-Dev` 身份及其独立的 userData 目录、单实例锁和记忆端口,以及默认的 `~/.penguin/dev-data` 数据根——改为由命令行开关选择的 **profile**,不再是"未打包运行"的副作用。已安装的 release 版加 `--dev` 启动即取该 profile,于是同一份安装可以并排跑两个实例:release 实例在 `~/.penguin/data`,第二个在 dev 根上,互不可见。未打包运行(`pnpm desktop`)仍默认 dev profile;`PENGUIN_HOME` 在两个 profile 下都仍然覆盖数据根。

## 细节

- `--dev` 按进程参数精确匹配;`--dev=…` 和 `--dev-tools` 都不算。Windows 上推荐的启动方式是复制一个快捷方式,目标末尾加 `--dev`。
- `--dev` 实例运行的是已安装 release 自身的代码。它用于在没有源码的情况下对着另一套数据使用应用,不是用来跑未提交修改的。
- dev profile 下更新器一律停用(`unsupported`,原因 `dev`),无论是否打包:它要替换的安装属于 release 实例,而后者可能正在旁边运行。
- 每次启动对捆绑 `penguin` 命令链接的修复只在 release profile 上进行,共用的安装因此只有一个 owner。
- `[shell] dev instance '<name>' on data root <root>` 启动行对每个 dev profile 启动都会打印,打包与否无关。
- dev 的 AppUserModelID 没有对应的已安装快捷方式,所以 `--dev` 实例的 Windows 通知可能不渲染;release 实例不受影响。

## 机器

profile 在实例触及的每台机器上都成立。壳以 `PENGUIN_PROFILE` 把它交给自己的 server(`pnpm dev:server` 和 `pnpm penguin` 脚本也会设置),Machines 页面安装、探测、启动、停止和连接的都是那台机器上该 profile 的安装:release 在 `~/.penguin`,数据在 `~/.penguin/data`,端口 7364;dev 在 `~/.penguin-dev`,数据在 `~/.penguin-dev/data`,端口 7371(`DEFAULT_DEV_SERVER_PORT`)。因此 dev 实例永远不会重启那台机器上别人正在用的 release server,两个 profile 在两端都各自保有 Agent、Session 和推送版本。每条远程命令都显式指明程序目录和数据根(`PENGUIN_INSTALL_DIR`、`PENGUIN_HOME`),不依赖远端的默认值。

- profile 以 `PENGUIN_PROFILE` 随每条远程命令一起传递,与 `PENGUIN_HOME` 并列,因此在某台机器上启动的 server 再去触及其他机器时,仍处于它被启动时的那个 profile。
- 那台机器上用户键入的 `penguin` 命令始终归 release 安装所有。dev profile 的安装以 `--no-modify-path`(`install.ps1` 为 `-NoModifyPath`)运行安装脚本;这是安装脚本新增的参数,不改动 `~/.local/bin/penguin`,也不改动 Windows 的用户 Path。
- 对远程启动的等待在被启动的进程退出后随即结束,并以对端日志作为失败原因,不再等满 30 秒。启动后记录的端口以那台机器自己报告的为准。
- 「Install 'penguin' Command…」菜单项只在 release profile 下提供,与每次启动时对该链接的修复一致。

## 兼容性

release profile 的数据根不受影响:其中的机器记录写下时的布局,就是现在读取它们的布局。

**dev profile** 的数据根(`~/.penguin/dev-data`,由 `pnpm dev`、`pnpm desktop` 或更早的 `--dev` 构建使用)里的机器记录,写于所有实例都触及 `~/.penguin` 的时候。这些记录不做转换,也没有任何宽容读取:记录的版本是那台机器的 dev 安装并不具备的版本,记住的端口是 release server 的端口。从这样的记录发起连接,要么带着那台机器自己的报错失败,要么把 dev server 启动在那里的 release server 回来时要用的端口上。

从 dev profile 的实例触及机器之前,先停掉该实例,清掉记录里记住的内容:

```sh
sqlite3 ~/.penguin/dev-data/web.db "UPDATE machines SET version = NULL, installed_at = NULL, remote_port = NULL;"
```

然后从 dev 实例安装一次。那台机器上无须删除任何东西,那里的 release 安装保持原样。
