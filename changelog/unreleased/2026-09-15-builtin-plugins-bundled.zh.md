# 内置插件以打包形态发布

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `plugins`, `build`
- **PR:** [#727](https://github.com/Prism-Shadow/penguin-harness/pull/727)

[English](2026-09-15-builtin-plugins-bundled.md)

热推送携带的内置插件目录原本是每个插件依赖树的 npm 安装结果，而每个安装出来的文件在推送里都是一个单独的 blob：约 1700 个文件，大头是语言插件为了五种语法装进来的整套 Shiki 语法库，以及 Discord 机器人为一条路由装进来的 Hono（ESM、CommonJS 与类型三份）。这么多零碎传输足以把推送卡住。

- Discord 机器人把 Hono 打进自己的包，语言插件把五种语法打进去；这些包移到 `devDependencies`。
- sandbox-dsh 保留 DSH 依赖链的树状安装：它在运行时以裸标识符挑选分平台的那一层，打包会把这一步变成解析不了的 import——Windows 那一层（受限令牌 + ACL）正是因此在那里报 “Cannot find package '@deepseek-ai/dsh-sandbox-windows-acl'”。这棵树约 160 个小文件，配合下面的压缩包，只占几个 blob 而不是每个文件一次传输。
- 仍保留为运行时依赖的只有原生模块：sandbox-dsh 的 `koffi` 与 landlock 启动器，它们按平台分发的二进制放不进打包文件。
- 这些二进制现在会为推送可能抵达的每个目标一并装入——Linux x64/arm64、Windows x64 与 macOS arm64——而不再只装构建机自己那一份。在 Linux 上构建的 prefix 不含 Windows 二进制，sandbox-dsh 的 Windows 运行器因此在那里报 “Cannot find the native Koffi module”；现在按各原生依赖自己声明的分平台包一并安装。
- `scripts/build-plugins.mjs` 在打包任何东西之前，拒绝声明了其他运行时依赖的内置插件，并点名该依赖。
- **资产以压缩包传输。** 部署把推送的每个包——插件目录里的每个包，以及 node-pty——各打成 `archives/` 下的一个确定性 `.tgz`（同样的文件得到同样的字节，没变的包就是没变的 blob），平台在加载插件或 node-pty 之前把它们解压一次到 `.unpacked/`。一次推送的资产从 433 个文件降到 19 个。把构建转交给其他机器时，转交的是压缩包，而不是本机解压出的文件。
