# UI 包发布到 npm，并构建 Workbench 运行时

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `ui`, `web`, `ci`, `tooling`
- **PR:** [#1417](https://github.com/Prism-Shadow/penguin-harness/pull/1417)

[English](2026-10-28-penguin-ui-on-npm.md)

`@prismshadow/penguin-ui` 不再是私有包。每次发版都以该版本号发布它，顺序排在 `@prismshadow/penguin-core` 之后、`@prismshadow/penguin-server` 之前。仓库内仍按源码读取这个包；新增的构建 `pnpm --filter @prismshadow/penguin-ui build` 产出 npm 包和 Web App 要用的文件。

## 发布的包

- `publishConfig` 为包定义了四个入口：`.`、`./highlighter`、`./styles.css` 与 `./fonts.css`。只有 `pnpm pack` 与 `pnpm publish` 会应用它。
- `dist/index.js` 与 `dist/highlighter.js` 是 ES 模块：React 是 peer 依赖，其余 npm 依赖保留为 import，不引入任何 CSS。每个入口各有一份汇总的类型声明，内联了 a2ui 的类型，包因此不再依赖 `@prismshadow/penguin-core`。
- `dist/styles.css` 用 Web App 的管线（Vite 加 `@tailwindcss/vite`）编译，包含 Tailwind 的基础重置、令牌桥、三套主题、组件用到的工具类、组件自身的 CSS，以及 KaTeX 的样式和它的 woff2 字体。
- `dist/fonts.css` 与 `dist/fonts/` 以可选方式提供界面字体，并附带许可文本。
- 组件引用的动画和 `no-scrollbar` 规则从 Web App 的样式表移入包内（`src/animations.css`，由 `theme.css` 引入）：`anim-pop`、`anim-fade`、`anim-msg`，提示条、抽屉与启动器扇形展开的类，以及它们的 keyframes。Web App 经 `theme.css` 得到同样的规则；`styles.css` 与运行时里的对话框、菜单、提示条和抽屉因此和应用一样有进场动画，减少动态效果时一并停止。
- 新增面向 npm 页面的 README，介绍安装、样式表、根元素上的主题属性、`UiStringsProvider`、代码高亮器和版本约定。

## Workbench 运行时

- 构建同时产出 `dist/workbench/`：面向浏览器的组件包（除 React 外的依赖全部打入）、React 生产构建的 ES 模块包装、样式表、列出这些文件的 `manifest.json`，以及页面做类型检查用的声明文件：包自身的、React 的，以及组件属性用到的 react-markdown、zustand 和其背后 unified 系列包的声明。
- Web App 的 Vite 配置以 `penguinUi({ workbenchRuntime: true })` 把它复制为 Web 产物下的 `workbench-runtime/`，缺少时构建失败。`scripts/deploy.mjs`、`Dockerfile`、CI 打包应用的作业和浏览器扩展的 e2e 脚本，都先构建 UI 包再构建 Web App。

## 发布与 CI

- `scripts/release-npm.sh` 为 UI 包写入版本号；`release.yml` 把 LICENSE 复制进去并发布它。
- CI 的 npm 打包作业对 `pnpm pack` 打出的包和运行时运行新增的 `scripts/check-ui-package.mjs`：把包装进一个临时项目，对正确与错误的属性各做一次类型检查，并核对渲染出的组件用到的类在 `styles.css` 中都有规则。
- 测试与类型检查的构建不再构建 UI 包，除非同时构建 Web App 的产物。
