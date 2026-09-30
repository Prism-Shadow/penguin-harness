# 热推送能到达已安装的发布版本：插件库的宿主包与重启这一步

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#614](https://github.com/Prism-Shadow/penguin-harness/pull/614)

[English](2026-09-04-hot-push-reaches-installed-releases.md)

有两件事挡住了热推送到达已安装的发布版本：插件库在 import 时查找宿主包，重启这一步又认领了一项没有任何发布版运行时提供的能力。两者都已去掉，从这里构建的平台能在任何已安装的运行时上加载并启动。

## 插件库的宿主包

往 Windows 安装热推送被拒绝，报 `No package.json above the plugin loader at …\hmr\store\platform`：平台包在加载时就抛了异常，因为 core 的插件库加载器在 import 时从包自身的路径向上找 package.json，而推送的包放在数据根目录的 store 里，上方没有任何包。宿主包——`dependencies` 里点名插件包的那份 package.json——现在在第一次调用插件库时确定，绝不在 import 时确定，起点是两个固定位置：加载器自身所在的安装，以及运行中的程序（`process.argv[1]`）所在的安装——推送的平台所能提供的插件正是装在那里。

- 每个起点各自向上，走到第一份 `dependencies` 点名插件包的 package.json；先试加载器自身所在的安装。途中不点名插件包、或读不出来、无法解析的 package.json 都会被跨过去，不拿它当答案。
- 不再退回「第一份读得出来的 package.json」：两个起点都找不到宿主时，插件库调用失败，错误列出实际试过的两个起点，而不是让推送失败、或让插件库悄悄变空。
- 程序路径先解析符号链接，于是包管理器的 bin 会指回它所属的那份安装。
- 插件包通过宿主包自己的 `require` 解析，于是推送的平台读到的是随程序安装的插件，而不是去 store 旁边找。

## 重启这一步

把当前平台热推送到任何已安装的发布版本上，都会在启动时被拒绝：`this runtime publishes no business capabilities this platform can claim (config: missing supervised) — update the installation itself`。软件更新弹窗的重启步骤把 `runtime:lifecycle` 加成了运行时的必需能力，把 `supervised` 加成了运行时所发布 `config` 的必需成员，而已安装的每个发布版本都早于这两者，于是没有任何现存安装能接受推送。这项能力被移除：重启这一步现在完全在平台内部完成，带着它的平台能在任何运行时上启动。

- 监督进程的宣告 `PENGUIN_SUPERVISED=1` 由平台直接从进程自己的环境变量读取；它是这项能力所承载的唯一事实，却被发布了两次。
- 为监督进程而退出，走的是运行时自己的优雅关闭——它注册在 SIGTERM 上的那一个——在进程内触发，并预先把 core 的 `SERVER_RESTART_EXIT_CODE` 放进 `process.exitCode`；关闭流程尊重预设的退出码而不再强制为 0。以事件方式触发而不是发信号，因为 Windows 不投递信号。
- 移除了 `LifecycleService`、`runtime:lifecycle` 资源、运行时接口描述符里的 `lifecycle` 与 `config.supervised` 条目，以及服务器配置里的 `supervised`。`penguin server|web` 的监督方式与之前完全相同。
- 对于有监督进程的运行时没有任何变化：「重启并更新」会真的重启它。在其他运行时上，路由回答 `no_supervisor`，一如既往。
- 重启退出码还会由一个 `exit` 监听器强制写入，所以即使运行时自己的关闭流程强制退出码为 0，推送上去的平台执行重启仍以该退出码离开、被监督进程重新拉起；所有安装都无需任何操作。等到不再支持任何会强制退 0 的运行时，这个监听器即可移除，也就是本版本发布之后的下一个版本。剩下的是回滚窗口：在更新弹窗与本次改动之间构建的平台会认领 `runtime:lifecycle`，在从这里构建的运行时上回滚到它会在认领阶段被拒；回滚到已发布的平台不受影响。
