# 桌面应用自行安装 `penguin` 命令

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `desktop`, `docs`
- **PR:** [#480](https://github.com/Prism-Shadow/penguin-harness/pull/480)

[English](2026-08-27-desktop-installs-cli.md)

桌面应用现在会不经询问地把随包的 `penguin` 命令放上 PATH，并在每次启动时重新检查。此前只有
deb 包会这样做；macOS、Windows 与 AppImage 只在首次启动时用一个对话框询问一次，此后不再过问。
由于应用与它携带的 CLI 出自同一次构建，由应用来安装该命令，也就保证了两者在更新中始终同步。

## 各平台的行为

- **macOS**——把 `/usr/local/bin/penguin` 链接到应用。先尝试普通权限写入，只有在确实被拒时才
  弹出管理员授权，也就是尚无 `/usr/local/bin` 的那种 Mac。取消该授权会被记录下来，应用不再询问；
  菜单项是重新安装的入口。
- **Windows**——把应用的 `bin` 目录追加到用户 `Path`（`HKCU\Environment`），与此前一致：幂等、
  只追加、无需提权。
- **Linux AppImage**——写入运行该 AppImage 的 `~/.local/bin/penguin` 包装脚本。
- **Linux deb**——不变；其 postinst 本就会创建 `/usr/bin/penguin`。

## 它不会做的事

- **替换不是本应用写入的 `penguin`。**该放链接的位置上是普通文件、符号链接指向别处、内容里没有
  每个随包启动器都带的标记——这些都会被原样保留，原因记录在 `userData` 下的 `cli-command.json`
  里。`install.sh` 会把自己的符号链接放在 `~/.local/bin/penguin`，正是 AppImage 形态使用的路径；
  让路的是本应用这一侧。菜单项 **Install 'penguin' Command…** 会在展示将被覆盖的内容之后，按用户
  意愿主动替换。
- **从不会长期存在的位置安装。**仍在挂载的 dmg 里、或被 Gatekeeper 以 translocation 方式运行的
  macOS 应用包，产生的链接会随卷的卸载而失效。此时应用会推迟安装，在下一次从「应用程序」启动时完成。

## 修复

每次启动都执行，才使它不只是创建、而是修复安装：应用被移动或更新后留下的悬空链接、或指向已移动
AppImage 的包装脚本，都会被重写为指向正在运行的这个应用。已经正确的 `penguin` 只花一次 `lstat`。

## 文档

`quickstart-desktop` 新增了 `penguin` 命令一节，覆盖四种形态与两类拒绝安装的情形；`quickstart`
不再让桌面端用户去做一次命令行安装来获得该命令。两页同时移除了 macOS 隔离标记与 Windows
SmartScreen 的首次启动说明——它们早已随未签名构建一同过时，与落地页和 README 的清理
（[#481](https://github.com/Prism-Shadow/penguin-harness/pull/481)）是同一处修正，只是应用到了文档站。
