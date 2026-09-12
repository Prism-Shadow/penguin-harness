# 从 npm 安装插件

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#672](https://github.com/Prism-Shadow/penguin-harness/pull/672)

[English](2026-09-10-plugin-npm-install.md)

为 Project 要求一个构建没有自带的插件，现在会**真的把包装上**：`POST /api/projects/:p/plugins/installed { specifier }` 在 `<root>/plugins` 里执行 `npm install`——这是 harness 唯一拥有且可写的目录（安装目录属于安装器，桌面应用的还在应用包内部）——装好之后才写入列表，因此 Project 永远不会指名一个不在机器上的包。加载器解析时优先看这个前缀，其次才是随构建发布的插件与安装目录。specifier 可以带版本范围（`pkg@1.2.3`）：安装该版本，并把它记为 Project `[plugins]` 表里该条目的要求（`"pkg" = "1.2.3"`）；键仍是纯包名，加载器按它解析。安装失败时报出的是 npm 自己给出的原因，而不是它的日志指针；registry、代理或私有 scope 的配置方式与机器上其他 npm 使用者一致。

从最后一个要求它的 Project 里移除插件，也会把包一起移除——用 `npm uninstall` 而不是删目录：`npm install` 会把包记进前缀自己的清单，绕开 npm 删掉的目录会在下一次安装任何东西时被装回来。
