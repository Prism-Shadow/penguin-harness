# 桌面应用重新能够连接飞书

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `desktop`, `tooling`
- **PR:** [#482](https://github.com/Prism-Shadow/penguin-harness/pull/482)

[English](2026-08-27-desktop-bundle-cjs-globals.md)

在桌面应用中绑定飞书应用时，凭据测试与连接都以 `__dirname is not defined` 失败，0.2.6 交付的消息集成
（[#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)）在桌面端完全不可用。只有桌面应用受影响：
npm 或 CLI 安装从 `node_modules` 解析 `@larksuiteoapi/node-sdk`，它在那里以 CommonJS 运行并获得自己的
`__dirname`；而桌面应用把 server 与 CLI 各自打成一个自包含的 ESM 文件，该 SDK 也被一并吸收进去。这些产物
携带的 banner 正是为此声明了 `require`，却没有声明 `__filename` 与 `__dirname`——于是 SDK 读取自身
`package.json`（用于在 User-Agent 头中带上版本号）时撞上未声明的标识符，整个连接过程随之失败。

banner 被收敛为 `scripts/esm-cjs-banner.mjs` 中的单一定义，并补齐了三者的声明，两处打包点都改为引用它：
构建发行应用的 `packages/desktop/tsup.config.ts`，以及构建热更新 platform 与 CLI 产物的
`scripts/deploy.mjs` 中的 `compileEntry`——后者在推送时会撞上同一堵墙。Telegram 绑定从未受影响：该
connector 直接使用 HTTP，不加载任何 SDK。

## 细节

这些声明恢复的是标识符本身，而非 CommonJS 赋予它的含义：在打包产物内部，`__dirname` 指向产物自身所在目录，
而不是该依赖发布时所处的目录。依赖若用它来寻找随自身一同发布的文件，仍会找错位置；而必须访问自身文件的依赖
根本不能被打包——node-pty 因此是以真实的包目录形式随产物一同交付的。飞书 SDK 处在该限制之内：其版本查找在
找不到时本就回退为 `unknown`，所以目录取错的代价仅是请求头中少了一个版本标记。

三者均以 `var` 而非 `const` 声明，使得某个被打包的模块若自行从 `import.meta.url` 推导 `__filename` 与
`__dirname`（常见的 ESM 样板写法），只是重复声明而不会与 banner 冲突。对 banner 已绑定的名字再作一次词法
声明会是解析错误，整个产物在加载时即告失败。
