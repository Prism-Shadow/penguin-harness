# machines 域的 web 半搬进 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `library/machine`, `packages/web`

[English](2026-11-24-library-machines-web.md)

machines 域的 web 半——Machines 页及其卡片、详情与 add-machine 对话框、ssh host 对话框、machines 的派生视图状态、其他表单会打开的 machine picker，以及启动它们的模块——从 web 应用搬进 `@prismshadow/penguin-library-machine` 自己的 `./web` 面（`library/machine/src/web/`）。web 应用用自己的程序编译这个面：library 的构建与 typecheck 仍是服务端半，面本身是宿主的 Vite 与 tsconfig 直接读取的 TypeScript 源码。

宿主与搬出的半沿用前一片 workspace 的两条接缝：搬出侧消费的应用内部件从 `@prismshadow/penguin-web/internal` re-export 取用，其余消费者一律直接 import 面（`@prismshadow/penguin-library-machine/web`，单个文件走 `/web/<module>`）；搬出代码没有任何对外公开的 import 路径。

## Details

- `library/machine` 增 `src/web/`（machines feature 的十四个文件）；`exports` 增 `./web` 与 `./web/*`；包的 `dependencies` 保持服务端——web 半的裸依赖放 `devDependencies`，由编译它的宿主解析。
- `packages/web` 在 tsconfig 里映射 machine 面，并把该 library 包列为 dev 依赖；`src/internal.ts` 增补搬出半读到的共享件（`lib/card-open`、`lib/notice-dismissals`、`lib/use-document-title`、`lib/format` 与 `lib/failure` 的读取器，及 `Tone` 类型）。
- web 应用自己的源码删去 machines feature 目录；machines 模块经面导入加入应用的启动。
