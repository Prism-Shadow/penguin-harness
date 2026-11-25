# workspace 域的 web 半搬进 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `library/workspace`, `packages/web`

[English](2026-11-24-library-workspace-web.md)

Workspace 域的 web 半——Files 面板的浏览器、旁边的只读目录浏览器、每个创建表单都会打开的 Workspace 选择器、回复链接 provider，以及 page workspace 的布局区——从 web 应用搬进 `@prismshadow/penguin-library-workspace` 自己的 `./web` 面（`library/workspace/src/web/`）。web 应用用自己的程序编译这个面：library 的构建与 typecheck 仍是服务端半，面本身是宿主的 Vite 与 tsconfig 直接读取的 TypeScript 源码。

宿主与搬出的半在两条新接缝上相会。搬出侧消费的应用内部件统一从 `@prismshadow/penguin-web/internal` 这一个枢纽 re-export 取用；对 dock 与尚未搬走的 feature 的引用暂时也走同一枢纽，等它们各自的面落地后统一切换。其余消费者一律直接 import 面（`@prismshadow/penguin-library-workspace/web`、`/web/page-workspace`，单个模块走 `/web/*`）；搬出代码没有任何对外公开的 import 路径。

对应用源码的守卫扫描学会了新根（`library/<domain>/src/web/`），规则继续在文件现在所在的地方评判它们。

## Details

- `library/workspace` 增 `src/web/`（workspace feature 的十一个文件）与 `src/web/page-workspace/`（五个文件）；`exports` 增 `./web` 与 `./web/*`；包的 `dependencies` 保持服务端——web 半的裸依赖放 `devDependencies`，由编译它的宿主解析。
- `packages/web` 经新的 `src/internal.ts`（以 `./internal` 暴露）re-export 自己的内部件，在 tsconfig 里映射 workspace 面，并把该 library 包列为 dev 依赖。
- web 应用自己的源码删去两个 feature 目录；workspace 模块经面导入加入应用的启动。
