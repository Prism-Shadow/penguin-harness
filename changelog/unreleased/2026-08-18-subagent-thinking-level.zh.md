# Subagent 思考等级：`run_subagent` 的 `thinking_level` 参数

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `docs`
- **PR:** [#323](https://github.com/Prism-Shadow/penguin-harness/pull/323)
- **Issue:** [#306](https://github.com/Prism-Shadow/penguin-harness/issues/306)

[English](2026-08-18-subagent-thinking-level.md)

`run_subagent` 工具新增可选参数 `thinking_level`，模型因此可以自行决定 Subagent 以哪一档思考等级运行——机械性的廉价子任务调低，硬骨头式的分析调高——而不再是每个子 Session 都只能跟着父 Session 的等级跑。默认工具条目的这次变化让配置 kernel 推进了一代，因此现有 Agent 会经历一次 kernel 更新。

## 细节

- 工具 schema 把 `thinking_level` 声明为一个枚举，取值是四个可选档位 `low` / `medium` / `high` / `xhigh`，与思考等级选择器保持一致。`none` 没有出现在可选集合里，因为不少模型无法关闭思考；它作为已存储值和线上传输值依然有效。
- 不传该参数时行为与此前完全一致：子 Session 继承父 Session 的有效等级，包括父级没有等级时那个表示「无等级」的三态 `null`。JSON `null` 等同于不传。
- 传入无法识别的取值会让这次调用直接失败，并列出有效选项，而不是悄悄让子 Session 跑在一个调用方并未要求的继承等级上。
- 该覆盖值经由 `SubagentRunner.spawn` 上新增的可选字段 `thinkingLevel`，一路送到 spawn 闭包里的 `createSession` 调用，其解析位置在「继承或 null」这层回退之上，因此父 Session 自身没有等级时，显式指定的等级同样生效。
- 四个档位以 `SUBAGENT_THINKING_LEVELS` 导出，并由一个测试对着 Project 默认档位表和随包发布的工具 schema 钉住，使这份集合的几处平行副本不会各自漂移。

## 兼容性

- 默认的 `run_subagent` 工具条目发生了变化，于是 `KERNEL_VERSION` 推进到 `2026-08-18` 这一代，其中唯一改动的叶子是 `tools.builtin.run_subagent`。因此现有的每个 Agent 都会经历一次 kernel 更新。
- 若某个 Agent 存储的 `run_subagent` 条目仍与某个旧默认值一致，它会自动推进到新 schema；用户改写过的条目原样保留；用户为关闭该工具而删除的条目继续保持删除状态，不会被重新加回。两种情况都无需手工操作。
- 这是第一代在某个工具叶子上与上一代默认值不同的 kernel，也因此第一次让 kernel 更新中「存储条目匹配某个旧代则推进」这条分支进入测试覆盖，并且是经由 history 接缝驱动的，覆盖不会随代际推移而失效。pre-toggles 的重建证明被改为按叶子而非按代退役，所以它继续为 `system_prompt` 提供证明——那正是被冻结的 `LEGACY_*` 常量所对应的叶子。

## 文档

- 双语的 tools 与 interfaces 文档页记录了新参数以及 `spawn` 上与之对应的字段。`SubagentRunner` 代码片段也顺带补上了此前遗漏的模型二元组中 `provider` 那一半。
