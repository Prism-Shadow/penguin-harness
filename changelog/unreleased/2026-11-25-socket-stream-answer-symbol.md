# Socket stream answers survive a twice-loaded http module

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `server`

[中文版](2026-11-25-socket-stream-answer-symbol.zh.md)

A socket-transported streaming call (history, trace body) carries its answer on the call's Request under a module-level symbol of `penguin-library-http`. An install can link that package twice — a direct link and a pnpm virtual-store copy — and each copy then held its own symbol, so the answer the socket layer carried was never found and every such stream fell back to a plain Response its reader cannot consume. The symbol is now a registry key (`Symbol.for("penguin-harness.stream-answer")`) shared by every copy of the module, so carrying and lookup always match.
