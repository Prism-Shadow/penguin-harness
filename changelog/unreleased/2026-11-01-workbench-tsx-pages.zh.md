# Workbench 页面可以用 TSX 编写

- **Date:** 2026-11-01
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1416](https://github.com/Prism-Shadow/penguin-harness/pull/1416)

[English](2026-11-01-workbench-tsx-pages.md)

Workbench 的页面可以是引入 React 与应用自身组件（`@prismshadow/penguin-ui`）的 `.tsx` 文件。`ui/` 下有 `.tsx` 时，每次加载都会与处理器一起对 `ui/` 下全部 `.ts` 与 `.tsx` 做类型检查，依据是应答服务端在其 Web 产物里携带的页面运行时（`workbench-runtime/`），并输出到 `.build/<revision>/ui/`。没有 `.tsx` 的 Workbench 加载与提供都与以前完全相同。

## 细节

- 页面以 `.js` 名加载编译后的代码（`<script type="module" src="app.js">`）：`GET …/workbenches/:id/ui/<file>` 先取磁盘上的文件，没有时取正在服务的实例输出的 `.js`。编译了页面的 Workbench，其 HTML 在 `<head>` 最前注入运行时的样式表（`link[data-penguin-ui]`）与 import map，两者都相对页面本身，因此机器上的 Workbench 运行的是那台机器的运行时。
- `GET …/workbenches/:id/sdk/ui/*` 提供运行时的文件，按 ETag 重新验证；清单与类型声明不对外提供。
- 页面只能引入 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@prismshadow/penguin-ui` 与 `ui/` 下的文件。引入其他包、引入 `ui/` 之外的代码文件、引入 CSS，以及同一路径的 `.ts`/`.tsx` 与 `.js` 并存，都会使加载失败，并以 `ui/<文件>:<行>:<列>` 点名；类型错误与处理器的写法相同（`ui/app.tsx:7:18 TS2322 …`），进入同一个 `error` 与 `.build/status.json`。加载失败时，即便重载的就是正在服务的修订，正在服务的页面也保持原样。
- 运行时的类型声明在内容不同时复制到 `.harness/ui/`，时机在处理器的类型装好之后。`.harness/README.md` 新增「Pages in TSX」一节：页面可以引入什么、各组件的属性在哪里查。
- 在没有运行时的服务端上，TSX Workbench 加载失败，错误点明查找的位置；没有 `.tsx` 的 Workbench 不受影响。
- TypeScript 编译器须带有 `lib.dom.d.ts` 与 `lib.dom.iterable.d.ts` 才会被采用。
- Web App 的应用框遇到带组件样式表的页面时不再注入基础样式表（`/workbench-ui.css`），主题、令牌与字体照常套用。
