# 共享 UI 包有了测试框架与去 AI 味守卫，Web 样式守卫同时扫描两个源码根

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `ui`, `web`
- **PR:** [#762](https://github.com/Prism-Shadow/penguin-harness/pull/762)

[English](2026-09-16-theme-w0-guards.md)

主题系统的共享 UI 包（`@prismshadow/penguin-ui`）新增了一套只在 Node 中运行的测试，按主题文件的计算值来
检验主题，并让包与 Web App 都遵守主题工作的去 AI 味规则；Web App 的样式守卫测试改为在 `packages/web/src`
之外同时扫描 `packages/ui/src`，任一源码根扫不到文件时按名字报错，而不是在组件于两处之间迁移时对着空集静默
通过。

## 包内测试

- `token-contract`：每个主题 × 明暗模式都在 `@layer ui-theme` 的规范选择器上，把 `tokens.ts` 中的每个名字
  各声明一次（基础规则，深色模式再加上深色规则），且不含契约之外的名字，深色规则也不得重复基础规则的取值；
  非默认主题还须重新指定全部十一级灰阶。契约共 188 个名字：含
  `--ui-radius-control`（桥接为 `rounded-control`）、`--ui-stack-0` 与 `--ui-stack-4`，不含
  `--ui-glass-highlight` 与 `--ui-fg-on-emphasis`；包、Web App 与画廊中写出的每个 `--ui-*` 名字（样式表与
  字符串字面量中）都必须是契约中的名字。Web App 与画廊的入口样式表须先导入 `themes/github.css`，再导入另两套
  主题，后两者的深色规则依赖这一顺序。
- `contrast`：从主题 CSS 解析出 WCAG 2 对比度——各表面上的正文（4.5:1）、页面表面上的色调墨色（3:1，
  `neutral` 除外）、色调底色上的色调文字与实心徽标文字（4.5:1）、主题强调色与每个用户预设上的强调色文字
  （4.5:1）。未达标项记入例外清单，某项一旦达标，测试即失败直到将其移除。
- `no-app-strings` 与 `no-theme-reads`：包内不从 Web App 的词典导入任何内容，主题机制之外也不读取主题 id。
- `demo-coverage`：每个组件目录都带有 `*.demo.tsx`，豁免清单初始为空。
- `font-licenses`：每个字体依赖的许可文本都镜像在 `src/fonts/LICENSES/` 下且与已安装包中的文本一致，
  样式表加载的每个字体文件都来自这样的依赖。没有 npm 包、列于 `src/fonts/vendored-fonts.json` 的字体，
  只能以 woff2 切片的形式放在自己的目录中，其许可文本放在 `LICENSES/` 下并写明许可名称；TTF 与 OTF 文件
  在任何位置都不允许。
- `boot-script`：对存储偏好的每种组合，`BOOT_SCRIPT` 绘制出的结果都与 `applyThemeAttributes` 一致，
  且 `packages/web/index.html` 原样内联了它。
- 仍是桩文件的主题、尚无字体或组件的包、尚无内联脚本的 index.html，都以具名的跳过用例报告，而不算通过。

## 去 AI 味守卫

- `src/testing/deslop.ts` 从 TypeScript AST（字符串字面量与模板文本，从不读注释）和 `@apply` 列表中读出
  Tailwind 类名，连同每个 JSX 元素的类名、直接子元素与所在组件，检查 22 条规则：过渡只列出颜色、不透明度
  或阴影属性（变换只允许出现在 chevron 以及 sheet、launcher、drawer 文件中）；不做悬停或按下时的变换；
  时长用 `duration-150` / `duration-200` 或时长令牌；嵌套圆角；裁剪圆角盒子上的边框；状态标记上的光晕与
  脉动；在自身墨色的浅底上放图标；彩色左边框提示框；同一色调的底色与边线并用；徽标里的情绪词；只有一个
  转圈文件，且不用 `border-t-transparent`；间距、堆叠与内边距落在节奏阶梯上；不写字面字号；`uppercase`
  与加宽字距只通过 eyebrow 与 display 钩子出现，且 eyebrow 不紧贴在标题之上；统计标签、计数与键值中的
  数字使用等宽数字；按钮、导航、标题与菜单的标签不用等宽字体；带边框的表面不嵌套；不用没有用途的渐变或
  背景模糊；阴影取自阴影令牌；颜色取自令牌；词典与测试数据中没有 emoji；页面标题不带 eyebrow。
- `packages/ui/test/deslop.test.ts` 在 `packages/ui/src` 上运行全部检查，允许清单为空；并检查各主题文件的
  标题令牌：h2–h5 均不大写，也没有哪级标题使用等宽字体。
- `packages/web/test/deslop.test.ts` 在 `packages/web/src` 上运行同样的检查，对照一份允许清单：列出应用
  现有的 390 处命中，分布在 99 个文件中，按文件与规则精确计数，每条都写明由哪一波次移除；Web App 中不检查
  调色板类名。
- `packages/ui/test/hooks.test.ts` 要求包、Web App 与画廊只使用 `src/hooks.ts` 中的六个样式钩子，每个钩子
  只能出现在承载它的组件中，并检查钩子样式所依赖的标记：`.ui-live` 带 `data-live`，`.ui-display` 位于
  页面标题上（`h1`、`[aria-level="1"]` 或 `<Heading level={1}>`），`.ui-frame` 的插槽为 `head`、`body`、
  `foot` 或 `pane`。

## 测试辅助

- `src/testing/` 新增：带每个根文件计数的源码根扫描器、CSS 规则读取器、沿主题层叠解析 `var()` 的主题文件
  分析器、颜色解析（十六进制、`rgb()`、`hsl()`、`oklch()`、`color-mix(in srgb, …)`）与 WCAG 对比度计算、
  静态渲染辅助函数，以及去 AI 味规则引擎。
- `packages/ui` 新增 `vitest.config.ts`；其 `test` 脚本不再在空测试集上通过。

## Web 守卫

- `packages/web/test/helpers/roots.ts` 列出两个源码根，并提供 `expectEveryRootScanned`、`sourceFile`
  与 `expectSingleHome`。
- 21 个样式守卫——`control-size`、`icon-scale`、`tone`、`disclosure-anchor`、`disclosure-body`、
  `company-click-targets`、`required-mark`、`info-popover`、`help-fold`、`title-reveal`、
  `session-activity`、`session-row-menu`、`company-beta`、`todo-notice`、`modal-focus`、`esc-layers`、
  `portal-panel-dismiss`、`context-menu`、`inner-html-stability`、`group-list`、`autofill`——都扫描两个根，
  断言每个根都扫到了文件，并断言所读的每个模块只存在于一处；文件以仓库相对路径命名。
- `GlyphIcon` 的描边改为读取 `--ui-icon-stroke`（回退值 1.7），`icon-scale` 断言这一点，并检查每个主题的
  该令牌取值属于线条族粗细 1.7 / 1.6 / 1.4。
