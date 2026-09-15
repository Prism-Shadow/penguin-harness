# 内置插件以打包形态发布

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `plugins`, `build`
- **PR:** pending

[English](2026-09-15-builtin-plugins-bundled.md)

热推送携带的内置插件目录原本是每个插件依赖树的 npm 安装结果，而每个安装出来的文件在推送里都是一个单独的 blob：约 1700 个文件，大头是语言插件为了五种语法装进来的整套 Shiki 语法库，以及 Discord 机器人为一条路由装进来的 Hono（ESM、CommonJS 与类型三份）。这么多零碎传输足以把推送卡住。

- Discord 机器人把 Hono 打进自己的包，语言插件把五种语法打进去，sandbox-dsh 把 DSH 整条依赖链打进去；这些包移到 `devDependencies`。内置插件目录现在是 167 个文件（6MB）。
- 仍保留为运行时依赖的只有原生模块：sandbox-dsh 的 `koffi` 与 landlock 启动器，它们按平台分发的二进制放不进打包文件。
- `scripts/build-plugins.mjs` 在打包任何东西之前，拒绝声明了其他运行时依赖的内置插件，并点名该依赖。
