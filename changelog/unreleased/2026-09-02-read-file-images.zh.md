# 读图并入 `read_file`；`input_command` 与 `exec_command` 共用超时

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `web`, `cli`, `server`, `docs`
- **PR:** [#588](https://github.com/Prism-Shadow/penguin-harness/pull/588)

[English](2026-09-02-read-file-images.md)

删除了 `read_image` 与 `describe_image` 两个工具，让 `read_file` 也能读图：`file_path` 指向 png/jpeg/gif/webp 文件（先按魔数、再按扩展名识别）或 http(s) URL 时，Session 模型接受图片就返回图像内容，不接受则由 Project 的 `vision_model` 回答新增的可选参数 `prompt`——两个旧工具的能力一项不少，只是收进一个名字、一份 schema。`read_file` 的超时放宽到 60000 ms，`input_command` 的超时与 `exec_command` 对齐为 120000 ms。

## 细节

- `read_file` 的文本行为不变（带行号的窗口、`offset` / `limit`、扫描上限、拒读秘密存储）。图片忽略 `offset` / `limit`；不是受支持图片的二进制内容照旧拒读并给出建议；URL 只作图片来源。
- 分支由 SDK 仅为 text-only Session 注入 Environment 的 `VisionDescriberService` 决定。它不存在时，图片经 `tool_call_output.images` 返回，文本只有一行 `image/png, 123.4 kB`；它存在时，图片连同 `prompt`（缺省为详细描述）单发视觉模型，其文本流式回传为工具输出，该请求的任何内容都不外泄进父会话流，用量记账不变。未配置 `vision_model` 时调用以 `fatal` 收尾，说明文字与此前相同，要求模型提醒用户选一个。
- 共享的图片加载从 `read-image.ts` 移入 `environment/tools/image-source.ts`；`read-image.ts` 与 `describe-image.ts` 连同其注册表工厂和默认配置条目一并移除。默认工具集为七个工具，均不带 `forModel` 标注——按模型类别装配的过滤仍是配置能力。
- `input_command` 空轮询的缺省等待从 120000 ms 降到 110000 ms，使缺省长度的轮询仍能在 120000 ms 的超时之下自行返回。
- 内核版本推进到 `2026-09-02`（工具 Tab 变动）：Web App 的内核更新会向未经编辑的工具 Tab 写入新的 `read_file` 条目并移除两个读图条目。既有 Agent 在此之前看到的样子记录在[向后兼容](2026-09-02-backward-compatibility-read-file-images.zh.md)。
- Web 工具卡按 `source` 参数预览旧 Trace 里的 `read_image` / `describe_image` 调用，与文件工具按 `file_path` 预览同一方式。模型设置的文案、CLI 的视觉模型帮助与文档改以 `read_file` 指称读图。
