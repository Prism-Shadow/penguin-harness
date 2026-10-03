# 分组设置：base URL 校验、保存时检测与关闭后写入的修正

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `server`, `web`, `cli`

[English](2026-10-03-provider-settings-fixes.md)

修正了[分组连接信息](2026-10-02-provider-connection.zh.md)中的三处缺陷：分组 base URL 未经校验即被保存；分组设置对话框过早跳过保存时的协议检测；在该检测期间关闭对话框后，保存仍会写入。

## 细节

- 已填写的分组 base URL 必须是以 http(s) 开头的完整 URL。`PUT /api/projects/:projectId/models/providers/:provider` 与 `PUT /api/projects/:projectId/models` 的 `providers` 成员对其他取值返回 400（`bad_request`），不写入任何内容；留空仍表示清除该项。不带 `--model-id` 的 `penguin config model add --provider <group> --base-url <url>` 拒绝此类取值（中英文提示齐备）；分组设置对话框拒绝保存，并在 base URL 字段下给出原因。
- 自定义分组或用户自建分组的协议为「未设置」时，只要组内有模型没有自己的协议，或组内尚无模型，分组设置对话框在保存时就会探测端点。此前只要有一个模型自带协议就会跳过探测，其余模型因此没有协议。
- 保存（包括保存时的协议检测）进行期间，分组设置对话框无法关闭（取消、Esc、点击遮罩、×）。若对话框在写入前被移除，该次保存不再发送 `PUT`。
