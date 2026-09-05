# 钩子包：启停开关、zip 导入导出与钩子标签页的 AI 导入

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#592](https://github.com/Prism-Shadow/penguin-harness/pull/592)

[English](2026-09-02-hooks-enable-import-export.md)

已安装的钩子包有了启停开关；Agent 设置页的钩子标签页补齐了技能标签页已有的能力：打包导出为 zip，以及一个既可上传 zip、也可经「让 AI 创建」组件包交给 Agent 去做的导入弹窗。钩子点胶囊改为只写钩子点名，并紧挨着包名显示。

## 细节

- `hooks.json` 接受 `enabled: false`；字段缺省即启用。core 组装 Session 的钩子时跳过已停用的包，从库重装保留原有开关。`setHookEnabled` 写入该标记、启用时再移除；`hookPackageEnabled` 是唯一的读取方。
- 服务端：`PATCH /api/projects/:p/agents/:a/hooks/:name { enabled }`（仅 Project owner）、`POST …/hooks/archive`（zip 内 hooks.json 与脚本在根目录或唯一顶层目录内；校验清单的名称、展示字段、`enabled` 与各钩子点的每条命令——命令必须指向压缩包内的文件；同名已装且未带 `overwrite` 时 409 `hook_exists`）与 `GET …/hooks/:name/archive`（已装目录打包为 zip，可字节一致地导回）。每次变更都像安装、卸载一样使该 Agent 已缓存的运行时失效。钩子路由从 `routes/plugins.ts` 移到 `routes/hooks.ts`，`HookItem` 带上 `enabled`。
- Web：钩子标签页每行在包名之后紧跟钩子点胶囊（`stop`、`user_prompt`、`pre_tool_use`），其下为描述，行尾依次是版本、开关（owner 可用；成员在停用行上看到「已停用」徽标，停用行对所有人都显示为变淡）、导出与卸载。「导入钩子」打开带「上传压缩包」/「让 AI 导入」分段控件的弹窗；AI 模式是一个 `AiCreatePanel`，带三个示例与一段固定尾注（审查步骤、包格式、脚本契约与安装目标），发送给 Project 的默认 Agent（发送给智能体 / 在新对话中编辑 / 复制提示词）。插件详情弹窗的胶囊同样去掉了「钩子」后缀，`S.plugins.hookBadge` 随之删除。技能标签页原有的打包下载逻辑抽成 `archive-download.ts`，两个标签页共用。
- 文档：技能页的钩子包一节、Web App 的 Hooks 行与服务端 API 表描述了开关、导入模式与打包路由。
