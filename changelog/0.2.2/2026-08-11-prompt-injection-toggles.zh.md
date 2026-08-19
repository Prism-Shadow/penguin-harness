# Skills、Vault 与 Schedules 采用 Memory 的提示词注入模式

- **Date:** 2026-08-11
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257)

[English](2026-08-11-prompt-injection-toggles.md)

其余三个借提示词生效的子系统现在遵循 Memory 确立的形态（[#257](https://github.com/Prism-Shadow/penguin-harness/pull/257)）：系统提示词模板只携带一个小节占位符，该小节的措辞是逐 Agent 可编辑的配置，而一个开关决定这一节是否被注入。

## 模板与配置

默认模板中硬编码的 `# Vault` 与 `# Skills` 小节，在原位置被替换为 `{{VAULT}}` 与 `{{SKILLS}}` 占位符，另有一个新的 `{{SCHEDULES}}` 占位符落在 `{{MEMORY}}` 之后。每一个都展开为其功能对应的提示词——`system_config.yaml` 中的 `vault.prompt`、`skills.prompt`、`schedules.prompt`，其中 Vault 与 Skills 默认沿用此前的内置措辞——并由 `vault.enabled` / `skills.enabled` / `schedules.enabled` 控制（默认开启）。原先的行内数据占位符在这些提示词内部继续有效：`{{VAULT_KEYS}}` 与 `{{SKILL_METADATA}}` 渲染 key 名列表与已安装 Skill 的条目行，而新的 `{{SCHEDULE_LIST}}` 渲染既有定时任务文件的清单（为空时附一句明确的「尚未定义定时任务」）。四个小节占位符在同一遍中展开，因此经由某一节到来的内容绝不可能把另一节的 token 偷渡进第二次展开。

## 让模型学会管理定时任务

新的默认 Schedules 提示词教模型用与 Memory 教它记笔记同样的方式来增删改查定时任务：通过普通的文件工具，不新增任何专用工具。它点明目录（`agent_state/schedule/`，一个任务一个 TOML），展示文件格式，并陈述字段规则——`prompt` 必填，`enabled` 默认为 false 因此一个生效的任务要显式设置它，ISO 8601 的 `start_at`/`end_at`，形如 `30m`/`12h`/`7d` 的 `period` 且下限为 5 分钟，`session_id` 与 `workspace`+`provider`+`model_id` 互斥——再加上卫生规则（创建前先看清单、就地编辑、删除已废弃的文件），以及服务端会在约 30 秒内对账该目录、无需任何注册步骤。

## 标签页

Skills、Vault 与 Schedules 三个标签页各自获得 Memory 标签页的那套控件：顶部一个启用开关（启用技能 / 启用密钥保险柜 / 启用定时任务，形态与 Memory 的开关一致——立即写入，不并入该标签页的保存），当模板缺少该小节占位符时的一条提示条（一键插入，或在旧模板上一键迁移——见[兼容说明](2026-08-11-backward-compatibility.zh.md)），以及底部一个可编辑的提示词小节，把该功能的内层占位符做成点击即插入的芯片。Vault 与 Schedules 保留它们仅所有者可编辑的约定。定时任务表格也不再在单元格中途折行：表头与紧凑列设为 nowrap，名称与目标截断并配悬停 title，而下次/上次触发时间在既有的横向滚动容器之上刻意堆叠为两行的单元格。

这些开关只管辖提示词注入——这一点写在配置文档里，而不是作为标签页文案：小节关闭时，Vault 的取值仍会作为环境变量注入 shell 子进程（模型只是失去了 key 名列表），调度器仍会触发既有任务，而已安装的 Skill 仍可经 `[use_skills]` 显式使用。
