# CLI：`penguin config model remove` 补齐模型 CRUD 缺口

- **Date:** 2026-08-11
- **Type:** feature
- **Scope:** `cli`, `core`, `docs`
- **PR:** [#273](https://github.com/Prism-Shadow/penguin-harness/pull/273)

[English](2026-08-11-cli-model-remove.md)

`penguin config model` 能新增条目、列出条目，也能把默认模型 / 视觉模型指向某个条目，唯独不能删除——而同级的 `config vault` 一直都有 `remove`。想删掉一个陈旧模型、或删掉内联在它上面的凭证，就只能去 Web App 的模型页，或者手工编辑 `.project_config.toml`，而后者恰恰被该文件自身的约定排除在外：它以 0600 权限写入，只允许经由系统接口读写。

- `penguin config model remove --model-id <id> --provider <group>` 删除一个模型条目，连同内联存储在它上面的凭证一并删除。引用的两个部分都必须提供且精确匹配，因此另一个 Provider 分组下同名的上游 id 不会被波及——这与其他 `model` 子命令遵循的「不做猜测」规则一致，只是这里守护的是删除而非凭证写入。配置中不存在的组合会在 stderr 上报告并以非零状态码退出，与 `vault remove` 保持一致。
- 当 `default_model` / `vision_model` 指向的正是被删除的条目时，这两项会被清空，与模型页删除时的既有行为一致。指针若继续指向一个已不存在的模型，下一次 `createSession` 会直接失败，因此确认信息会带上删除后生效的默认模型；如果这次删除同时导致视觉模型被清空，也会一并说明。
- 新增 core 的 `removeModel(root, projectId, ref)`，与 `removeVaultEntry` 一样幂等：不存在的组合不算错误、也不写入任何内容，是否需要提示交由调用方决定。
