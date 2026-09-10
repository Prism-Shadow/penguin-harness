# A resource id says which layer owns it

- **Date:** 2026-09-09
- **Type:** improvement
- **Scope:** `server`
- **PR:** [#656](https://github.com/Myriad-Dreamin/penguin-harness/pull/656)

[中文版](2026-09-09-resource-ids-say-which-layer.zh.md)

Every entry in the hot-update registry was named `runtime:…`, whether it was a capability only the process can provide or the platform's own state parked there so a swap would not lose it, and a block of comments carried the distinction instead. The ids carry it now: `hmr:config`, `hmr:db`, `hmr:channels`, `hmr:proxy-control`, `hmr:host`, `hmr:desktop`, `hmr:lifecycle` and `hmr:interfaces` are the HMR layer's capabilities; `platform:auth-state`, `platform:overrides` and `platform:plugins` are parked platform state.

The old ids stay registered and claimed as aliases for one release; see [backward compatibility](2026-09-09-backward-compatibility.md).
