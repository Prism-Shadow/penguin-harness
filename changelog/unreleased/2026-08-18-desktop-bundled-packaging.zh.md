# 桌面安装包改由打包产物构建，不再自行组装依赖树

- **Date:** 2026-08-18
- **Type:** refactor
- **Scope:** `desktop`, `cli`, `ci`

[English](2026-08-18-desktop-bundled-packaging.md)

桌面应用不再随包分发 `node_modules` 树。`pnpm build` 现在把外壳、服务端与 CLI 各自打成一个自包含产物，输出到
`packages/desktop/dist/`，安装包里装什么则完全由 `electron-builder.yml` 声明——取代了 `scripts/stage.mjs`：它用
`pnpm deploy --prod` 组装出应用目录，再手工裁剪、改写其 `package.json` 并把资源逐个拷进去。

## 细节

- `tsup.config.ts` 分别打包 `src/main.ts`、服务端包的入口与 CLI 的入口，每个产物独立成一个文件，不共享 chunk。
  `electron` 保持 external——它的 npm 包只是一个从磁盘读取二进制路径的 shim。`scripts/deploy.mjs` 为热更新产物
  使用的 `createRequire` banner 在这里同样启用，被打包进来的 CommonJS 依赖因此照常工作。
- 无论源码运行还是打包后的应用，外壳都按应用路径 fork `dist/server.js`，两者运行的是同一份产物。`penguin` 启动脚本
  指向 `dist/penguin.js`，AppImage 的引导代码也由同一个常量推导出路径片段。
- `scripts/build-assets.mjs` 负责 `pnpm build` 该产出的三样非 JavaScript 内容：技能库放在 `dist/` 旁边，正好是被打包的
  读取逻辑按包相对路径查找的位置；运行时窗口图标放入 `dist/`；以及 `bin/` 下的启动脚本。
- 前端资源由 electron-builder 在打包时映射进来。安装包不再携带 source map。
- 随安装包分发的应用目录从 128 MB 降到 29 MB。
- MinGit 改为下载到 `packages/desktop/build/minigit`，electron-builder 的输出目录改为 `packages/desktop/out/`。

## 兼容性

在桌面安装中执行 `penguin update`，过去会被判定为 npm 全局安装并给出 `npm install -g` 命令，而那会装出第二份互不相干的
CLI。现在它会说明该 CLI 随桌面应用分发，并在应用更新时一并替换。
