# 钩子包：启停开关、zip 导入导出与钩子标签页的对话导入

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#592](https://github.com/Prism-Shadow/penguin-harness/pull/592)

[English](2026-09-02-hooks-enable-import-export.md)

已安装的钩子包有了启停开关；Agent 设置页的钩子标签页补齐了技能标签页已有的能力：打包导出为 zip，以及与导入技能同款的导入弹窗——推荐的对话导入在上，zip 上传在下。钩子点胶囊改为只写钩子点名，并紧挨着包名显示。

## 细节

- `hooks.json` 接受 `enabled: false`；字段缺省即启用。core 组装 Session 的钩子时跳过已停用的包，从库重装保留原有开关。`setHookEnabled` 写入该标记、启用时再移除；`hookPackageEnabled` 是唯一的读取方。
- 服务端：`PATCH /api/projects/:p/agents/:a/hooks/:name { enabled }`（仅 Project owner）、`POST …/hooks/archive`（zip 内 hooks.json 与脚本在根目录或唯一顶层目录内；校验清单的名称、展示字段、`enabled` 与各钩子点的每条命令——命令必须指向压缩包内的文件；同名已装且未带 `overwrite` 时 409 `hook_exists`）与 `GET …/hooks/:name/archive`（已装目录打包为 zip，可字节一致地导回）。每次变更都像安装、卸载一样使该 Agent 已缓存的运行时失效。钩子路由从 `routes/plugins.ts` 移到 `routes/hooks.ts`，`HookItem` 带上 `enabled`。
- Web：钩子标签页每行在包名之后紧跟钩子点胶囊（`stop`、`user_prompt`、`pre_tool_use`），其下为描述，行尾依次是版本、开关（owner 可用；成员在停用行上看到「已停用」徽标，停用行对所有人都显示为变淡）、导出与卸载。「导入钩子」改用技能标签页的弹窗形态：推荐的对话导入在上，先是钩子来源字段（URL / 仓库 / 本地路径 / 一段描述，或其他工具的钩子配置——粘贴整段配置正是它用多行输入框的原因），其下实时预览生成的 Prompt（按来源给出的首句加上固定尾注：审查步骤、包格式、脚本契约与安装目标），再是「复制 Prompt」与在该 Agent 上「打开新对话」，来源为空时两者一同置灰；zip 上传排在其下。技能导入弹窗的「打开新对话」也随「复制 Prompt」一同置灰——此前来源为空时它会打开一个空白对话，把刚生成的 Prompt 丢掉。插件详情弹窗的胶囊同样去掉了「钩子」后缀，`S.plugins.hookBadge` 随之删除。技能标签页原有的打包下载逻辑抽成 `archive-download.ts`，两个标签页共用。
- 文档：技能页的钩子包一节、Web App 的 Hooks 行与服务端 API 表描述了开关、导入弹窗与打包路由。
