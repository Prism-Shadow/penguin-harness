# sandbox 域的 web 半搬进 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `library/sandbox`, `packages/web`

[English](2026-11-24-library-sandbox-web.md)

sandbox 域的 web 半——编辑每用户终端/浏览器开启数上限的管理员设置卡（`ResourceLimitsSection`，设置对话框资源限制页背后的那张卡）——从 web 应用的 settings feature 搬进 `@prismshadow/penguin-library-sandbox` 自己的 `./web` 面（`library/sandbox/src/web/`）。这张卡是 capability 的管理员侧，其 service、policy 读取与 status 读取的服务端半已在 library 里；它编辑的上限正是 sandbox service 执行的那些。web 应用用自己的程序编译这个面：library 的构建与 typecheck 仍是服务端半，面本身是宿主的 Vite 与 tsconfig 直接读取的 TypeScript 源码。

宿主与搬出的卡沿用前三片 workspace、machines、terminal 的两条接缝：卡消费的应用内部件从 `@prismshadow/penguin-web/internal` re-export 取用（管理员设置端点、未保存更改 scope、strings 运行时与 API 错误 toast），卡的消费者——设置对话框——直接 import 面（`@prismshadow/penguin-library-sandbox/web`）。搬出代码没有任何对外公开的 import 路径。

## Details

- `library/sandbox` 增 `src/web/`（搬入的卡与 face 入口）；`exports` 增 `./web` 与 `./web/*`；`dependencies` 增 `@prismshadow/penguin-library-setting`（卡表单种子的限额默认值），web 半的裸依赖（react、UI 包、internal 接缝解析所需的 web 面）放 `devDependencies`，由编译它的宿主解析。
- `packages/web` 在 tsconfig 里映射 sandbox 面，并把该 library 包列为 dev 依赖；`src/internal.ts` 增补卡读到的管理员设置端点与未保存更改 scope。
- settings feature 的源码删去搬出的卡、经面读取；该节的单测同样经面导入。
