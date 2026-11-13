# 打开组织内被引用文件的接口

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#1483](https://github.com/Prism-Shadow/penguin-harness/pull/1483)
- **Issue:** [#1440](https://github.com/Prism-Shadow/penguin-harness/issues/1440)

[English](2026-11-05-cited-file-route.md)

`GET /api/projects/:projectId/organizations/:orgId/file?path=<引用的路径>` 返回员工引用的文件，Project 的任何成员都可以调用。路径按原样读取，可以是 `<app_data_dir>/…`、`~/…` 或绝对路径。

## 细节

- 解析链接之后，文件必须位于组织的手册、公共工作区，或组织架构里某位员工的工作区之下。员工的工作区被人指向别的目录时也算在内。每次请求都重新从组织架构读取这些根目录。
- `.project_config.toml` 和 `.vault.toml` 无论在哪里都拒绝，按写出的文件名判断，也按链接解析后的文件名判断。
- 这些根目录之外的文件返回 `403 org_file_refused`。文件不存在或是目录时返回 `404 org_file_not_found`，相对路径返回 `400 org_file_invalid`。
- 返回方式和 Files 面板相同：默认内联，`?download=1` 下载，HTML 以纯文本返回，除非 `?preview=1` 要求沙箱页面。
