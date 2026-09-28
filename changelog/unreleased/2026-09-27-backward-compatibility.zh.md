# 向后兼容：常驻的 ssh 机器种类

- **Date:** 2026-09-27
- **Type:** process
- **Scope:** `server`, `plugins`
- **PR:** [#855](https://github.com/Prism-Shadow/penguin-harness/pull/855)

[English](2026-09-27-backward-compatibility.md)

## `machine-ssh` 不看 Project 的列表，总是加载

服务端加载哪些插件，由各 Project 的配置决定（`.project_config.toml` 的 `[plugins]`）。机器种类成为插件之前，机器就是 ssh，而没有哪个 Project 列出 `@prismshadow/penguin-plugin-machine-ssh`。只按这条规则，部署在用的每台 ssh 机器都会连不上，直到有人启用一个谁也不知道需要启用的插件。

所以服务端有一个**常驻**插件，即 `packages/server/src/plugin/loader.ts` 的 `RESIDENT_PLUGINS`：无论 Project 是否列出，它都在每个服务端上最先加载。它不在任何 Project 的列表里，所以把 Project 的插件同步到它的机器时，既不会把它推过去，也不会把它删掉；每台机器按同一条规则、从自己的构建里加载它。它加载失败时，与其他插件一样报告并跳过：服务端照常启动，ssh 机器显示为「种类不可用」，直到下一次推送修好它。服务端自己的热推送（`/api/hmr`）不经过机器，不受影响。

范围：每个服务端。无需手工处理；已有的 `ssh:<别名>` 记录、`/server/<machineId>/…` 代理与 Project 的成员关系都保持不变。

## Compatibility

只要 ssh 还是插件，常驻规则就一直保留，没有移除日期。它是一个通用机制，目前只登记一项。再加第二个常驻插件会改变每个服务端加载的内容，需要单独评审，并在这里单独写一条。
