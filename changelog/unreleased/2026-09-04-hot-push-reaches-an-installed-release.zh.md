# 插件库在首次使用时才寻找宿主包，重启这一步不再认领运行时能力

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#614](https://github.com/Prism-Shadow/penguin-harness/pull/614)

[English](2026-09-04-hot-push-reaches-an-installed-release.md)

有两件事挡住了热推送落到已安装的发布版上。往 Windows 安装推送被拒绝，报 `No package.json above the plugin loader at …\hmr\store\platform`：core 的插件库在 import 时就从自身路径向上找 package.json，而推送的包放在数据根的 store 里，上方没有任何包。另一件是重启这一步把 `runtime:lifecycle` 变成了运行时的必需能力，于是早于它的每个安装都在握手阶段被拒。现在插件库在第一次调用时才寻找宿主包，重启这一步则完全不向运行时认领任何东西。

## 细节

- 宿主包在两处寻找：像以前一样在加载器自身模块的上方，以及在正在运行的程序（`process.argv[1]`）上方——推送的平台所能提供的插件正是装在那里。`dependencies` 里点名了插件包的第一个 package.json 即为宿主；找不到时取遇到的第一个能读出来的 package.json，因此源码检出、npm 安装和打包的桌面应用的解析结果与之前完全一致，而途中读不出来的 package.json 会被跨过去，不拿它当答案。
- 完全没有宿主包的机器现在能加载这个包，随后的插件库调用会失败并列出两处查找位置，而不是让推送失败。
- 移除了 `LifecycleService`、`runtime:lifecycle` 资源、运行时接口描述符里的 `lifecycle` 与 `config.supervised` 条目，以及服务器配置里的 `supervised`。监督进程的宣告 `PENGUIN_SUPERVISED=1` 由平台直接从进程自己的环境变量读取；退出走的是运行时自己的优雅关闭——它注册在 SIGTERM 上的那一个——以事件方式在进程内触发而不是发信号，因为 Windows 不投递信号。
- 对于有监督进程的运行时没有任何变化：「重启并更新」会真的重启它。在其他运行时上，路由回答 `no_supervisor`，一如既往。`penguin server|web` 的监督方式与之前完全相同。

## 兼容性

- 重启退出码除了预置在 `process.exitCode` 上，还会由一个 `exit` 监听器强制写入。本次改动之前构建的每个运行时，其优雅关闭都以显式的 `process.exit(0)` 收尾，而热推送替换不了它——没有这个监听器，推送上去的平台执行重启会把服务停掉，而托管进程不会再把它拉起来。所有安装都无需任何操作；等到不再支持任何会强制退 0 的运行时，这个监听器即可移除，也就是本版本发布之后的下一个版本。
- 在更新弹窗与本次改动之间构建的平台会认领 `runtime:lifecycle`，而从这里构建的运行时不再发布它。把已更新的安装回滚到这样的平台会在认领阶段被拒；回滚到已发布的平台不受影响。
