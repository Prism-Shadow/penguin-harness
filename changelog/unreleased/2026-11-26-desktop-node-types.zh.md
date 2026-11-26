# 桌面端工作台恢复正常加载

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `desktop`, `workbenches`

[English](2026-11-26-desktop-node-types.md)

- 打包后的桌面应用现在以 extra resources 携带 `@types/node` 与 `undici-types` 的声明文件，electron-builder 对 `*.d.ts` 的排除不再留下只有 manifest、没有声明的空壳。
- 服务端仅在 `@types/node` 的入口声明存在时才采用它，对被剥离的副本与缺少默认库的编译器一样跳过；没有完整副本时，不导入 `node:` 的工作台仍可加载。
- `verify-packed-cli.mjs` 在打包产物缺少这些声明时报错。
