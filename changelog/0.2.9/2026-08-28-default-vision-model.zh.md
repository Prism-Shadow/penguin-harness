# 新建 Project 的默认模型能看图了

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `server`, `docs`, `skills`
- **PR:** [#534](https://github.com/Prism-Shadow/penguin-harness/pull/534)

[English](2026-08-28-default-vision-model.md)

新建 Project 的默认模型此前是 `deepseek/deepseek-v4-flash`，它只支持文本；而全新安装同样没有配置 `vision_model`，于是粘贴进来的截图根本没有可读的路径——它会被保存到 scratchpad 并以文件路径交出，而本该代读它的工具以「本 Project 未配置视觉模型」结束。默认模型现在改为 `deepseek/deepseek-v4-flash-vision-exp`，它自己就能读图。

## 细节

- **仅影响新建 Project。** Project 的默认模型在创建时被复制进去，此后归它自己所有；没有任何写入路径会改写既有配置，「同步预置」也从不触碰已存的默认模型。既有 Project 像以往一样，自己选一下即可切换。
- README 与 CLI、SDK 两份快速上手里的首次运行命令仍带着旧 id 与 `--set-default`，在全新安装上会把默认模型又钉回纯文本的那个。六处命令均已改为新的默认模型，`models` 与 `configuration` 中的示例、紧随其后的 `vision = false` 举例，以及 `penguin-sdk` Skill 一并更新。
- core 的测试现在断言的是**性质**而不是那个 id——无论默认模型指向谁，它在目录中的条目必须 `supportsVision`——这样以后再改默认模型，就不会悄悄退回到一个会拒绝它收到的第一张图片的模型上。
