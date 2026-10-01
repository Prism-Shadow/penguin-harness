# 向后兼容

- **Date:** 2026-09-30
- **Type:** process
- **Scope:** `server`, `cli`, `web`, `model-catalog`
- **PR:** [#914](https://github.com/Prism-Shadow/penguin-harness/pull/914)
- **Breaking:** yes — 模型表 PUT 与 `penguin config model add` 若要往 custom、vLLM 以外的内置分组新增不属于该分组预置的模型，一律拒绝（`400 model_not_addable` / 退出码 1）；已存的条目照常工作，也从不被改写

[English](2026-09-30-backward-compatibility.md)

[模型配置页对齐模型选择器](2026-09-30-models-page-refresh.zh.md)收回了 custom、vLLM 以外所有内置分组的「添加模型」入口，服务端和 CLI 也拒绝同样的新增。跨版本存活的只有一样：用户已经加进这些分组的模型。

## 旧形态：网关分组里手动添加的模型

在这一版之前，网关分组——TokenDance、OpenRouter、Fireworks AI、SiliconFlow、OpenCode Go、两个 Qwen 分组、ModelScope——都接受手动添加模型，无论来自模型配置页、API 还是 `penguin config model add`。因此 `.project_config.toml` 里可能有这些分组的 `[[models]]` 条目，其 `(provider, model_id)` 不在内置目录里。这样的条目是能用的：它和旁边的预置一样带着网关的端点和协议。

选择：**原样保留，不做迁移。** 拒绝只针对本次请求新引入的条目。同一 `(provider, model_id)` 键下已存的条目原样通过；在本组内改名也通过，此时 `renamedFrom` 指向本组一条已存的行。从别的分组移入则视同新增，因为那正是把它加进这个分组的动作。一方厂商分组同理：此前可路由、但不属于预置的 id 也曾被接受。

**用户无需做任何事。** 条目留在原分组，照常可用，也可以在模型配置页编辑、在组内改名或删除。以后要添加的模型放进 custom 或自己创建的分组。

## 没有计划移除的内容

这是一条校验规则而不是兼容垫片：没有读取旧格式的第二条代码路径，也没有会到期的东西。Project 删掉的预置模型随时可以加回它自己的分组，「同步预置」做的就是这件事。

## 兼容性

升级无需任何操作。这一版之前写下的配置照常加载和保存。变化的是今后能写入什么：往 custom、vLLM 以外的内置分组新增不属于预置的模型，模型表 PUT 返回 `400 model_not_addable`，`penguin config model add` 以退出码 1 拒绝。添加这类模型的脚本改用 `--provider custom` 或自己的分组名，并附上 `--client-type` 与 `--base-url`。
