# 资源 id 说明它属于哪一层

- **Date:** 2026-09-09
- **Type:** improvement
- **Scope:** `server`
- **PR:** [#656](https://github.com/Myriad-Dreamin/penguin-harness/pull/656)

[English](2026-09-09-resource-ids-say-which-layer.md)

热更新 registry 里的每个条目都叫 `runtime:…`，不论它是只有进程能提供的能力，还是平台为了不在 swap 中丢失而停放在那里的自有状态，区别只写在一段注释里。现在由 id 本身说明：`hmr:config`、`hmr:db`、`hmr:channels`、`hmr:proxy-control`、`hmr:host`、`hmr:desktop`、`hmr:lifecycle` 与 `hmr:interfaces` 是 HMR 层的能力；`platform:auth-state`、`platform:overrides` 与 `platform:plugins` 是停放的平台状态。

旧 id 作为别名继续注册与认领一个版本，见[向后兼容](2026-09-09-backward-compatibility.zh.md)。
