# 员工引用文件时带上标签

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `plugins`, `server`
- **PR:** [#1486](https://github.com/Prism-Shadow/penguin-harness/pull/1486)
- **Issue:** [#1440](https://github.com/Prism-Shadow/penguin-harness/issues/1440)

[English](2026-11-05-cited-file-labels.md)

员工在频道消息或 desk 回复里引用文件时，要写成 `[它是什么](<app_data_dir>/…)`，读者看到的是几个字，并能直接从消息里打开文件。`company-employee` Skill 升到 `2026.11.05.1`，已有的组织在下一次调和时就会换上。

## 细节

- `company-employee` 的「Writing a channel message」新增「Cite a file with a label」一条，讲路径的段落也指向它，适用于所有给人读的内容。
- 新建组织时写入的手册用中英文加了同样一行。已有组织的手册保持不变。
