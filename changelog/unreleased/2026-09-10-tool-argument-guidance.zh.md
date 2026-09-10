# exec_command 接受 `command` 作为 `cmd`,被拒的调用自带改法

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`

[English](2026-09-10-tool-argument-guidance.md)

把 shell 文本写成 `command` 而非 `cmd`(其他 harness 的 shell 工具用的参数名)的模型,此前每一次 `exec_command` 调用都被一行「缺少参数」拒绝,并且通常会原样重发同一调用。现在 `exec_command` 会执行以 `command` 携带文本的调用(schema 仍只声明 `cmd`,两者同时出现以 `cmd` 为准);每个因参数被拒的内置工具,也都以一份完整的纠错指引作答,而不再是一行话。

## 细节

- 别名经工具、命令策略与调用预览共用的同一份名单读取:策略筛查的正是工具将执行的文本,Web App 与 CLI 的 `$ …` 预览——用户审批时看的那一行——也会显示它。
- 纠错指引点出出错之处(缺失、类型不符、为空或不可用,若经别名送达也一并点明)、列出实际收到的参数名并点出工具未声明的名字、按交给模型的 schema 重述全部参数(名称、类型、必填与否、别名、说明),并以携带全部必填参数的正确调用形态收尾。末句重述工具名与参数名,服务端异常台账保留的输出尾部因此仍能说明出了什么错。
- 覆盖范围:`exec_command`(`cmd`)、`input_command`(`process_id`)、`run_subagent`(`prompt`)、`input_subagent`(`subagent_id`)、`read_file`(`file_path`,以及不可用的 `offset` 或 `limit`)、`write_file`(`file_path`、`content`)、`edit_file`(`file_path`、`old_string`、`new_string`)。
