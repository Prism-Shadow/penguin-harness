# Penguin Go MMSP 路由

- **日期：** 2026-10-12
- **类型：** feature
- **范围：** `core`、`server`、`docs`

[English](2026-10-12-penguin-go-mmsp.md)

Penguin Go 预设、新授权、重新授权和模型同步直接使用 MMSP HTTP 客户端。已有 Project 配置在加载时迁移。

## 路由和请求

- 设备授权轮询和详细目录同步发送 `x-penguin-protocol: mmsp`。
- Go 的所有模型都使用 MMSP，包括仍提供旧路由的目录。仅包含 MMSP 的目录无需旧端点字段。
- 平台提供 base URL，通常为 `https://go.penguin.ooo/api/v1`；SDK 追加 `/stream`，处理历史消息、工具、思考、媒体和 usage。

## 已有 Project

迁移不需要网络探测或重新登录，更新分组路由和模型级覆盖项，保留 ID、key、当前选择、账号元信息、价格、折扣和模型自定义设置。用户自建分组及改为其他服务器的端点保持原配置。参见[向后兼容](2026-10-12-backward-compatibility.zh.md)。
