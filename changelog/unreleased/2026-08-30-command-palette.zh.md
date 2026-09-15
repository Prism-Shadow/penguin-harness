# Ctrl+P 打开命令面板；第一条命令是 harness 历史

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `web`, `server`, `core`

[English](2026-08-30-command-palette.md)

Ctrl+P（macOS 上为 ⌘P）打开一个 VS Code 风格的命令面板：一个输入框筛选命令列表，↑↓ 选择，Enter 执行，Escape 关闭。面板是机制；命令向它注册，而不是各自占用快捷键。

## Harness 历史

目前唯一的命令：一个覆盖在当前页面之上的层——几乎占满窗口、只留一圈窄边，Escape、关闭按钮或点击边缘就回到原来的位置——列出这台服务器的数据根通过热更新提交过的 harness 版本，最新在前——推送方记录的 checkout 修订与仓库（若有）、提交时间、标识代码本身的内容寻址 platform / cli / web bundle、当前提交的是哪个版本——以及**每次推送改了什么**。记录由 platform 而不是运行时维护：运行时只提交版本（`harness.json`）；启动起来的 platform 就是那个版本，它在每次启动时把提交记录连同自己构建所用的接口表（`ifaces.json`）写到 `<root>/harness-history/`——运行时 store 旁边、它自己的目录——所以只要运行时老到还能启动这个 platform，历史就是完整的。页面把每个版本的表与前一个比对：树的节点新增、移除或改了接线（requires、provides、contributes、children、exports），接口新增、移除或逐成员变化，以及数据类型变化的计数。`GET /api/version/history/ifaces/:hash` 返回存储的表，`GET /api/version/history/diff?from=&to=` 返回差异。

`GET /api/version/history` 连同运行时当前提交一起返回这份记录（最新 100 条）。

**模块树。** 每个版本在"变化"旁边还有"模块树"视图：它记录的表所描述的整棵树——组、组下的模块与组件，以及任一节点需要什么（来自哪个模块）、提供或导出什么、投递什么。

**回滚。** 运行时的 store 只为每种产物保留一份回滚副本；platform 自己在 `<root>/harness-history/versions/` 下保留最近五个完整版本——每个版本就是一次机器间移交所转发的升级体（bundle、web 归档、带可执行位记录的原生资产、来源信息），由 Machines 页面所用的同一个读取器生成。任何保留了产物的版本都有"回滚到这个版本"按钮（管理员，两次点击）：platform 在进程内把保留的升级体交给运行时的升级通道——不经网络、不涉及绑定地址、HTTPS 门禁或 token——并在切换前先应答。推送落地后所有标签页会像收到外部推送一样重新加载；被运行时拒绝的推送则让 platform 继续运行，拒绝原因以运行时的原话显示在历史上（`GET /api/version/history` 的 `lastRollback`）。`POST /api/version/history/rollback { id }`。

记录本身在运行时的提交落地之后才写入，而不是在启动时：推送时运行时在启动成功后才提交，过早写入的一行会把上一个版本的 bundle 记在新 platform 的接口表之下。写入是原子且串行的，读取历史不会写任何东西。
