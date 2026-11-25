# terminal 域的 web 半搬进 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `library/terminal`, `packages/web`

[English](2026-11-24-library-terminal-web.md)

terminal 域的 web 半——独立 `/terminal` 页、池化的 xterm 视图及其运行时、dock 的终端面板、其下的 connection/frames/stream/links/touch/keys 各件，以及启动页面的模块——从 web 应用搬进 `@prismshadow/penguin-library-terminal` 自己的 `./web` 面（`library/terminal/src/web/`）。web 应用用自己的程序编译这个面：library 的构建与 typecheck 仍是服务端半，面本身是宿主的 Vite 与 tsconfig 直接读取的 TypeScript 源码。

宿主与搬出的半沿用前两片 workspace、machines 的两条接缝：搬出侧消费的应用内部件从 `@prismshadow/penguin-web/internal` re-export 取用（含 dock store、dock 的 terminal 辅助与 panel registry——dock 暂留在宿主侧），其余消费者一律直接 import 面（`@prismshadow/penguin-library-terminal/web`）。dock 的 `dock-terminal.ts` 经面读 terminal list，terminal↔dock 的导入环随搬移消失。搬出代码没有任何对外公开的 import 路径。

## Details

- `library/terminal` 增 `src/web/`（terminal feature 的十八个文件加五个单测）；`exports` 增 `./web` 与 `./web/*`；包的 `dependencies` 保持服务端——web 半的裸依赖（react、xterm 各包、UI 与 web-plugin 包）放 `devDependencies`，由编译它的宿主解析。单测由 web 应用的 Vitest 配置跑，其 include 增了面的 test 目录。
- `packages/web` 在 tsconfig 里映射 terminal 面，并把该 library 包列为 dev 依赖；`src/internal.ts` 增补搬出半读到的共享件（theme、coarse-pointer 与 viewport 钩子、shortcut label 与 terminal 按键/剪贴板 action、terminal-machine 解析器、session probe 与 API url，及 terminal http 辅助）。
- web 应用自己的源码删去 terminal feature 目录；terminal 模块经面导入加入应用的启动，应用的 module 清单守卫删去应用内 terminal 条目。
