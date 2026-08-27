# 扩展机制：一个入口，两个带类型的事件

- **Date:** 2026-08-22
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#353](https://github.com/Prism-Shadow/penguin-harness/pull/353)

[English](2026-08-22-extension-mechanism.md)

harness 有了扩展缝。扩展包导出一个函数 `activate(ctx)`，服务端在读取 `<root>/extensions.json` 时每进程执行它一次，此时还没有任何 App 存在。此后的一切都以带类型的事件到达：`"initialize"` 交出定义视图，扩展在其中注册 workflow factory；`"create"` 交出组装好的实例视图。两者在每次 App 创建时都会触发，因此热更新会重新投递，扩展的注册不可能只留在已被替换掉的实例里。

## 细节

- 一个部署运行哪些扩展属于配置，而不是编进平台的能力：`<root>/extensions.json` 列出包 specifier，每一条都相对**安装目录**解析而非平台 bundle，因此安装或升级扩展是安装侧的动作。文件不存在即表示没有扩展；文件存在却读不出、或格式错误，则启动失败——而不是装作健康、悄悄丢掉配置要求的全部能力。无法解析的条目、没有 `activate` 导出的模块、或 `activate` 失败，按条目记录并跳过；该 `activate` 此前已登记的清理项会在它被丢弃前执行。
- 扩展加载排在单实例预检之后，因此一个即将以退出码 3 结束的进程不会去 import 第三方模块，也不会执行它们的顶层副作用。
- `ExtensionEvents` 把每个事件名映射到它的载荷——事件词汇表只有这一处，因此新增一个事件会同时为平台的 emit 端和所有扩展 handler 提供类型。
- `activate` 可以是 async，并会被等待。订阅与 `ctx.disposables` 在它 settle 后封闭，此后再调 `on(...)` 会抛错。事件 handler 保持同步——返回 promise 的 handler 会被拒绝，因为 App 是围绕这次 emit 同步组装的，rejection 只能以未处理形式逃逸。workflow 重名同样被拒绝，名字归属不会随 `extensions.json` 顺序改变。disposable 可以是 async，关停时并发执行、单条失败被隔离，并在与会话管理器收尾相同的 5 秒预算内被等待。
- workflow 就是注册加一次普通函数调用——没有 Session、没有审批、没有流式。每个注册的 factory 在注册关闭后整批实例化，每个 App 一次。
- 扩展包所编译依赖的契约声明在 SDK 里，即 `@prismshadow/penguin-core/extension`。`PenguinContext` 与 `PenguinInterface` 是开放的：harness 通过声明合并贡献自己拥有的成员，并从 `@prismshadow/penguin-server/extension` 一并再导出。两个子路径都不携带运行时代码，因此扩展始终是一个自足库。
- 服务端的启动次序、各子系统的对外表面与扩展生命周期，记录在新增的「服务端启动」页面（`packages/docs/content/server-boot.zh.md`）。
