# 钩子：一个 Agent 级总开关、zip 导入导出与钩子标签页的对话导入

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#592](https://github.com/Prism-Shadow/penguin-harness/pull/592)

[English](2026-09-02-hooks-enable-import-export.md)

钩子有了启停开关，口径与技能一致：一个 Agent 级的总开关，而不是每个已装包各有一个标记。Agent 设置页的钩子标签页同时补齐了技能标签页已有的能力：打包导出为 zip，以及与导入技能同款的导入弹窗——推荐的对话导入在上，zip 上传在下。钩子点胶囊改为只写钩子点名，并紧挨着包名显示。

## 细节

- `system_config.yaml` 新增 `hooks.enabled` 小节（缺省即启用），且没有 prompt 的一半——钩子包是在循环钩子点上运行的脚本，不是进入上下文的文本。关闭后，此后新建的 Session 不组装任何钩子，已安装的包全部留在磁盘上，照常列出、照常可导出。core 在构建 Session 时与钩子包一并新鲜读取该值。
- 服务端：开关走 Agent 配置路由（`PUT …/config`，body 为 `{ config: { hooks: { enabled } } }`；GET 以 `config.hooks` 回报），带该字段的配置写入会使该 Agent 已缓存的运行时失效——钩子包在 Session 构建时绑定，否则已缓存的运行时会一直沿用构建时的那套。新增钩子路由：`POST …/hooks/archive`（zip 内 hooks.json 与脚本在根目录或唯一顶层目录内；校验清单的名称、展示字段与各钩子点的每条命令——命令必须指向压缩包内的文件；同名已装且未带 `overwrite` 时 409 `hook_exists`）与 `GET …/hooks/:name/archive`（已装目录打包为 zip，可字节一致地导回）。钩子路由从 `routes/plugins.ts` 移到 `routes/hooks.ts`。
- Web：钩子标签页顶部是与技能标签页同款的启停开关卡片（仅 Project owner，成员只见状态）；其下每个包一行，包名之后紧跟钩子点胶囊（`stop`、`user_prompt`、`pre_tool_use`），其下为描述，行尾依次是版本、导出与卸载。「导入钩子」改用技能标签页的弹窗形态：推荐的对话导入在上，先是钩子来源字段（URL / 仓库 / 本地路径 / 一段描述，或其他工具的钩子配置——粘贴整段配置正是它用多行输入框的原因），其下实时预览生成的 Prompt（按来源给出的首句加上固定尾注：审查步骤、包格式、脚本契约与安装目标），再是「复制 Prompt」与在该 Agent 上「打开新对话」，来源为空时两者一同置灰；zip 上传排在其下。技能导入弹窗的「打开新对话」也随「复制 Prompt」一同置灰——此前来源为空时它会打开一个空白对话，把刚生成的 Prompt 丢掉。插件详情弹窗的胶囊同样去掉了「钩子」后缀，`S.plugins.hookBadge` 随之删除。技能标签页原有的打包下载逻辑抽成 `archive-download.ts`，两个标签页共用。
- 文档：技能页的钩子包一节、配置表、Web App 的 Hooks 行与服务端 API 表描述了开关、导入弹窗与打包路由。
