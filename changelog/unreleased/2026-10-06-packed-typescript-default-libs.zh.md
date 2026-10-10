# 桌面安装包带上 TypeScript 默认库，推送自带的编译器排在最前

- **Date:** 2026-10-06
- **Type:** fix
- **Scope:** `desktop`, `server`

[English](2026-10-06-packed-typescript-default-libs.md)

在把编译器放进桌面安装包之后构建的安装包上，所有工作流都加载失败：`.build/status.json` 为 `ok: false`，报 `…/resources/app/dist/node_modules/typescript/lib/lib.es2022.full.d.ts not found`。

- 桌面安装包现在在编译器入口旁带上它的默认库文件（`lib.*.d.ts`）。electron-builder 不让任何 `*.d.ts` 进入 `files`，所以它们作为 extra resources 复制到同一个目录。
- `verify-packed-cli.mjs` 发现安装包缺少构建目录里编译器的任何一个文件就失败。
- 服务器找编译器的顺序改为：推送带来的那份，自身模块旁边的那份，正在运行的程序旁边的那份。原先推送带来的排在最后。
- 缺默认库文件的编译器不采用，继续看下一处。三处都不可用时，错误信息逐处写明原因，并指名缺的文件。

已经装了不完整安装包的机器在下一次推送后恢复，不需要重装。
