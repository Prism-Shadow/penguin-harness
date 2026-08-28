# 扩展市场：注册表、共享索引格式与扩展市场页

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[English](2026-08-20-extension-marketplace.md)

为 harness 加入了扩展发现能力：服务端的注册表抽象、共享的扩展索引格式，以及 Web App 中列出四个沙盒后端包的扩展市场页——每个条目都可打开，进入带说明文档的详情页。

## 细节

- 引入了**扩展注册表（extension registry）**概念：一个注册表即一个扩展索引条目来源。本次实现两种——服务端包内嵌索引的**内置注册表（builtin registry）**，以及拉取 `index.json` URL 的 **HTTP 注册表**。两者共用同一个校验器，远端索引不会比内嵌索引获得更多信任。
- 所有注册表共享同一份**扩展索引格式**，参考 typst/packages 的 `index.json` 模式：扁平数组，每个元素是扩展的一个版本条目，含 `name`、`version`、`description`、`authors`、`license`，可选 `repository` / `homepage` / `keywords` / `categories` / `updatedAt`。条目的 `name` 就是运维写入 `extensions.json` 的包名。
- 新增 `GET /api/extensions`（任何已登录用户可访问），返回已配置注册表合并后的索引。注册表列表当前固定为内置注册表，其中列出四个沙盒后端：bubblewrap（Linux）、Seatbelt（macOS）、MXC（Windows）与 DSH 适配器。
- Web App 新增**扩展市场**页，位于导航组中模型库之后：单列列表——标识一个扩展的是它的包名，长、带 scope、等宽字体，双列恰好会截断运维来这里要读的那串字符。每一行都可点开对应条目。仅用于发现——安装扩展仍是运维侧编辑 `extensions.json` 的操作。
- **条目详情页**承载它的元数据与渲染后的说明文档，因此选择一个沙盒后端不必再去读它的源码。说明文档按条目单独通过 `GET /api/extensions/readme?name=…` 获取，而不随索引下发：列表每次进入页面都要完整发送，而说明文档体积大，且只有被打开的那个条目才需要。该端点只对部署自己列出的条目作答，因此无法用来探测存在哪些扩展；注册表没有某条目的说明文档时返回 null，而不是猜一个 URL。说明文档就是各后端包自己的 `README.md`，内置注册表在构建期把它内联进来，因此目录里不存在第二份会与之漂移的副本；测试把每个条目的 name、version、description 与 license 钉在包自己声明的值上。四个后端各自写明了它们实际强制了什么——bubblewrap 的挂载顺序与非特权用户命名空间要求、Seatbelt 后规则覆盖前规则的 SBPL 与路径规范化、MXC 仅限 Windows 且覆盖全部三个维度的映射与可选的约 40MB 配套 SDK，以及 DSH 适配器的平台链与仅 `fs-write` 的词汇。
