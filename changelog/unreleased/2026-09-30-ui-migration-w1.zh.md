# 图标、状态标记与操作组件迁入共享 UI 包

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-ui-migration-w1.md)

UI 包迁移的第一批把 Web App 的基础组件移入了 `@prismshadow/penguin-ui`。Web 端的副本已删除，引用方改从包根导入；包内组件的文案经 props 传入，颜色取自主题 Token。

## 迁入的组件

- **图标**：按图形命名的 `ICONS` 注册表，以及 `GlyphIcon`、`Chevron`、固定网格的小标记（`ChevronDown`、`CheckIcon`、`PlusIcon`、`DownloadIcon`、`UploadIcon`、`CloseIcon`）和 `ICON_SIZE` / `ICON_GAP`。功能文件里各处共用字形的副本（加号、返回箭头与左右尖角、旋转箭头、钥匙、眼睛、书、时钟等）改为从注册表读取，注册表为此新增 `plus`、`key`、`keyOff`、`rotateCw`、`arrowLeft`、`chevronLeft` 与 `chevronRight`。
- **头像与标志**：`AgentAvatar`、`UserAvatar`、取代两处手写叠放的新组件 `AvatarStack`、`ProviderLogo` 与 `PenguinLogo`。
- **状态与反馈**：新建的 `Dot`、`StatusIcon`、`ActivityIcon`（原 `SessionActivityIcon`）及 `BackgroundTasksMark`、`ScheduleMark`、`UpdateDot` 与 `UpdatePill`、`Badge`（按色调名取色，新增 `variant` 与 `size`）及新建的 `Count`、`Skeleton` 与 `EmptyState`。
- **操作**：`Button`（新增 `link` 变体、`xs` / `icon-sm` 尺寸与 `loading`）、新建的 `IconButton`、新建的 `Link`、`CloseButton`、`CopyButton`、新建的 `Kbd` 与 `HiddenFileInput`。
- **文案**：`UiStrings` provider 承载包内自带的无障碍兜底文案（关闭、已复制、加载中），由 Web App 按界面语言提供。

## 细节

- Web 端新增一项检查：功能文件里仍手写的字形路径登记在按波次分组的清单里，新出现的一条会直接报错。
- 新增主题 Token `--ui-mark-new`，用于更新提示点。每个主题都声明它，通用主题保留原来的浅红。

## 默认主题（通用）的可见变化

- 徽标与更新提示胶囊的文字 11 → 12 px。徽标分浅底、描边、实底三种样式；原 `brand` 徽标改为中性实底，「免费」徽标由黄色改为信息色（天蓝）。
- 状态图标 13 → 14 px，运行中状态改用 Spinner 的弧线绘制。
- 浅色模式下的色调文字（成功、注意、危险）各深一档。
- 未读点由 emerald-500 改为 emerald-700，固定 6 px。
- 按钮：`secondary` 文字深一档，`ghost` 文字浅一档，悬停底色各移一档。
- 链接改用链接色 Token，并以外链图标代替「↗」。
- 做成按钮样式的 label（各处导入控件）在键盘聚焦时显示主题的焦点轮廓。
- 行内的复制按钮为 20 px 见方。
- 关闭按钮悬停时的底色与文字各浅一档。
- 空状态文字浅一档。
- 骨架屏底色仍为 gray-200，改由线条 Token 提供。
- 头像色块的文字颜色按各主题的实际底色重新测定。
