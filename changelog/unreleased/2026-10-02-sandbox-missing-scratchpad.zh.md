# Session scratchpad 尚未创建或已被删除时，沙盒内的命令照常启动

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `server`, `core`

[English](2026-10-02-sandbox-missing-scratchpad.md)

`workspace-write` 下，Session scratchpad 以可写方式绑定进沙盒。它只在第一次有东西写入时才被创建，Session 存续中也可能被某条命令、Agent 或用户删掉。它缺失期间，bubblewrap（Linux 后端，以及 Windows WSL 后端内部所用的那一个）会因绑定挂载的源路径不存在而拒绝启动，该 Session 的每一条命令和每一个 hook 都起不来。

- `workspace-write` 下，沙盒服务在每次受约束的 spawn 之前，若 Session scratchpad 不存在就先创建它；已存在时不做任何改动。其他模式不绑定它，也不创建它。
- scratchpad 建不出来时，命令以点明 scratchpad 与底层 errno 的错误失败，不会在没有 scratchpad 的情况下继续运行。
- `SandboxPolicy.writableRoots` 的文档写明：后端收到策略时，每个可写根在宿主上都已存在；后端既不创建它，也不跳过缺失的根。
