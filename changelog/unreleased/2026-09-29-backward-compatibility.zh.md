# 向后兼容：2026.09.29.1 之前的钩子包中的 `user_prompt` 命令

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `core`, `plugins`
- **PR:** [#891](https://github.com/Prism-Shadow/penguin-harness/pull/891)

[English](2026-09-29-backward-compatibility.md)

[钩子包随模型上下文读取，`user_prompt` 钩子在每条 Prompt 上运行](2026-09-29-hooks-per-context-and-every-prompt.zh.md)改变了未写 `trigger` 的 `user_prompt` 命令的含义：此前它只在宿主按名启动时运行，改动之后则在用户每次提交 Prompt 时运行。各 Agent 上已安装的 `goal` 包，其 `start.mjs` 没有写 trigger，而这个脚本在缺少预算时会启动一个不设预算的目标；若按新的读法，每条普通消息都会变成一次不设预算的目标。

## 兼容的旧形态

`packages/core/src/plugins/index.ts` 中的 `userPromptTrigger(manifestVersion, command)` 对 `version` 为早于 `USER_PROMPT_EVERY_PROMPT_SINCE`（`2026.09.29.1`）的插件版本（`YYYY.MM.DD.N` 或旧写法 `YYYY-MM-DD.N` 均可）的清单沿用旧读法：其中没有写 `trigger` 的 `user_prompt` 命令一律按 `trigger: "host"` 读取。这些命令不参与每条 Prompt 的咨询，goal 的启动仍能经 `Session.runUserPromptHook` 找到它的命令。命令显式写出的 `trigger` 始终优先；没有版本、或版本不是插件版本格式的清单按新读法读取。core 以这种方式读取某个包时，每个进程对每个包目录向 stderr 写一行提示（`packages/core/src/agent.ts` 中的 `remindToUpdate`）。

## 生效范围

清单带有这类版本、且含未写 `trigger` 的 `user_prompt` 命令的每个已安装钩子包。实际上就是从插件库安装的 `2026.09.01.1` 及更早版本的 `goal` 包，`default_agent` 预装的正是它。`continual-learning` 没有 `user_prompt` 命令，不受影响。手写的钩子包只有照抄了 `2026.09.29.1` 之前的版本号时才受影响。

## 用户需要做什么

从插件库更新 `goal` 插件；插件已升至 `2026.09.29.1`，插件库的更新提示会给出这项更新。在此之前不会出现任何问题：旧包照常启动目标，也不会在普通 Prompt 上运行。无论是人还是 Agent，手工修改旧包时，给每条 `user_prompt` 命令写上明确的 `trigger`；要让这些命令在每条 Prompt 上运行，则提高 `version`。

## 何时可以移除

在 0.3.0 发布准备时，由负责该次发布的人移除。前提：0.3.0 的发布说明要求更新 `goal` 插件，让仍在使用旧包的安装在这一读法移除之前得到更新提示。移除的内容：

- `packages/core/src/plugins/index.ts` 中的 `predatesEveryPromptHooks`、`USER_PROMPT_EVERY_PROMPT_SINCE` 与 `userPromptTrigger` 里按版本回退的分支，此后缺省的 `trigger` 即表示 `"prompt"`；
- `packages/core/src/agent.ts` 中的 `remindToUpdate`；
- `packages/core/test/hook-packages.test.ts` 中针对旧清单的用例；
- 技能与插件文档页（`skills.en.md` 与 `skills.zh.md`）中关于旧读法的提示、agent-initialization Skill 的 `reference/hooks.md` 中对应的一句，以及设计文档 Hook 一节中的兼容段落。
