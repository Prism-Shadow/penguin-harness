# 本地组件画廊：在每套主题下渲染共享 UI 包

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `ui-gallery`, `ui`, `tooling`, `ci`
- **PR:** [#764](https://github.com/Prism-Shadow/penguin-harness/pull/764)

[English](2026-09-16-theme-gallery.md)

新增私有包 `@prismshadow/penguin-ui-gallery`：一个 Vite + React 应用，把共享 UI 包分别在三套主题（Primer、Frost、
Console）、浅色与深色、16 / 18 / 20 px 三档根字号、中英文下展示出来。它是本地开发工具，用 `pnpm dev:gallery` 在
7372 端口启动，不随产品发布。Web App 没有任何改动。

## 画廊

- 单页长滚动，共十五个模块：基础、对话、输入区、侧栏与导航、按钮与操作、状态与反馈、表单、浮层、表格与列表、
  统计与图表、Markdown 与代码、文件与目录树、页面与分区、公司看板、整页。每个模块是一幅由共享 fixture（一次
  docs-expert 会话，中英文各一份）搭出的真实合成，带三到五个变体；标题行写模块名与一句说明，卡片内含变体胶囊与
  可直接引用的路径，例如 `Frost › Conversation › Approval · dark · zh`。
- 左侧吸顶栏切换主题、明暗、根字号与语言，开关对比与减弱动效，并列出全部模块。对比会同时呈现三套主题：窄模块
  三栏并排，宽模块整宽堆叠；`compare=<module>` 只对比单个模块，其余模块保持单主题。
- 每个视图都有地址。URL 记录主题、明暗、字号、语言与每个模块选中的变体；`/embed?module=<id>&variant=<key>` 单独
  渲染一幅合成，`/embed?demo=<part-id>` 仍可单独渲染一个部件。
- 每个模块有三个抽屉：部件（已有的组件演示，以及每个计划中组件的一行说明，标注波次与它将替代的 Web 代码）、
  该合成实际读取的令牌（按当前主题与明暗解析，并给出 WCAG 对比度）、模块自身的源码。
- 基础本身也是一个模块：调色板、中英文排版尺度、形状与层次、节奏步长、按主题描边绘制的图标册、动效、焦点与
  选区，以及挂在配方所选结构上的六个样式钩子。
- `/screens/<name>` 展示 `packages/ui/src/screens` 中的整页合成；`/fonts` 列出各主题的字体族、按字体族与字重归并
  的已声明字体（含切片数量与加载状态）以及许可文本。
- 画廊界面文案有中英文两份，只属于画廊本身。

## 包内新增

- `packages/ui/src/module.ts` 定义模块契约（`defineModule`、`MODULE_IDS`），`packages/ui/src/modules/*.module.tsx`
  放置由包自己拥有的十三幅合成——基础与整页两个模块由画廊拥有，它们本就由画廊自身的机制搭成。
  `packages/ui/src/catalog.ts` 把每个组件分区归入所属模块，`packages/ui/src/demo.ts` 定义演示契约（`defineDemo`）。
- 这些合成本身不含数据：所有文字与数字都来自 `packages/ui/src/fixtures/`。在整页已用的数据集之外，fixtures 补上了它们
  所需的部分——失败的引用测试、Task 的待办清单、斜杠菜单、一篇文档回答、插件库统计、群聊、停靠面板的添加菜单、对话框
  表单的搜索框与选项组，以及所模仿页面的界面文案。

## 工具

- `pnpm --filter @prismshadow/penguin-ui-gallery shots` 经 `/embed` 为模块 × 变体 × 主题 × 明暗 × 语言拍摄截图，
  `--parts` 另外拍摄原子演示。若主题声明的某个字体族没有成功加载，该次运行判为失败；`shots.mjs diff <before>
  <after>` 可逐像素比较两次运行。
- 根目录的 `pnpm dev:gallery` 启动画廊；manual-test 技能收录该入口；CI 在 `rest` 分片运行画廊的单元测试，
  `pnpm -r build` 会构建画廊。
