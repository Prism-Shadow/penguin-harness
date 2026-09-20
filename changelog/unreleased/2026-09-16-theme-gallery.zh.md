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
- 画廊界面文案有中英文两份，只属于画廊本身。画廊自身的样式只作用于自身：相关规则都限定在 `.g-chrome` 下，
  因此预览里的行内代码与文本选中色取自主题，单视图、对照视图与截图三者一致。预览框读取契约令牌时不再提供
  回退值，令牌缺失会在评审主题的那张卡片里直接显示为破损。
- 令牌抽屉会说明自己测到了什么：始终没有挂载的合成，以及无法读取的规则，都会被点名，而不是看起来像
  「这个合成读取得很少」或「仍在解析」。

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
- `shots.mjs` 会按 `/embed` 认识的取值校验每一个维度：主题、模式、语言、字号档中有未知取值，或某个模块
  渲染失败时，直接让整轮失败，而不是把一套看似完整的截图写到错误的名字下。

## 守卫

- `packages/ui/test/app-source-scope.test.ts` 约束 Web App 的 Tailwind 源：`packages/ui/src` 下的每个
  目录要么随应用发布，要么被排除在扫描之外，新增的画廊专用目录无法把类名混进应用样式表。
- 画廊自己的测试新增了：令牌抽屉背后的遍历、Colour 面板从 `theme.css` 读取的主题色预设、与矩阵键冲突的
  维度取值，以及对每个模块每个变体的一次渲染——最后一项会在两个变体画出同样内容时失败。
