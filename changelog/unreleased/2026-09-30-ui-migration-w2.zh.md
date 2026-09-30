# 表单控件迁入共享 UI 包

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-ui-migration-w2.md)

UI 包迁移的 W2 把 Web App 的表单控件搬进 `@prismshadow/penguin-ui`，并补上应用里一直手写的几种控件。

## 迁入的内容

- **共享菜单面板**（`menuPanelClass`、`menuRowClass`、`menuRowTone`、`ChoiceCheck`）：所有菜单与选择器共用的面板、行状态与勾选标记。
- **字段与输入框**：`Field` 及其标签、提示与错误，`RequiredMark`，`Input` 与 `Textarea`（支持框内前后缀），`PasswordInput`。
- **选择器**：`Select`、`OptionMenu`、`PickerList`（从模型选择器中抽出的「搜索框 + 可键盘遍历的列表」）、`Segmented`、`Switch`、`SwatchPicker`（强调色色块），以及设置行 `PrefRow`、`SettingRow` 与 `SettingsSection`。
- **从 W3 提前的浮层**：`usePortalPanel`、`InfoPopover`（标签旁的「?」）与 `HelpFold`。
- **新增控件**：`Checkbox`（含半选态）、`Radio` 与 `RadioGroup`、`SearchInput`（字段、面板、菜单三种形态，带清空按钮），以及取代八处手写开关行的 `ToggleRow`。

## 细节

- 包自带的无障碍兜底文案新增「显示/隐藏密码」「清空搜索」「更多信息」，由 Web App 按界面语言提供。
- `FormPicker` 暂留在 Web App，等 W3 迁移它包裹的下拉组件。

## 通用主题下可见的变化

- 复选框与单选按钮由主题绘制（14 px，强调色填充），不再是浏览器原生控件。
- 搜索框统一样式并带清空按钮；技能与机器选择器里第一次按 Esc 清空搜索词，第二次才关闭。
- 菜单行：悬停与当前项底色浅一档，选项文字深一档。
- 字段标签浅一档；出错时去掉红色底，只保留红色边框。
- 分段控件内边距改为 4 px（高 4 px）；深色下选中段更深。
- 色块悬停不再放大，改为加一圈边框。
- 若干 11 px 的说明文字（选项描述、代理探测地址、定时任务的 id 后缀）改为 12 px。
