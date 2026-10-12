# 向后兼容：Penguin Go 路由

- **日期：** 2026-10-12
- **类型：** process
- **范围：** `core`、`server`

[English](2026-10-12-backward-compatibility.md)

Penguin Go 保存的旧路由直接切换到 MMSP。[MMSP 路由](2026-10-12-penguin-go-mmsp.zh.md)在 Project 加载配置时迁移；授权和目录同步还会应用平台下发的 MMSP 端点。

## 迁移范围

内置 `penguin-go` 分组 ID 和 Go 所属端点共同限定迁移范围。现有配置迁移流程更新分组和模型级覆盖项，不发网络请求、不依赖保存的 key，也包含已退役的模型 ID。迁移幂等，保留其他字段、用户自建分组和改为其他服务器的端点。不进行能力协商，也不回退旧协议。

## 移除条件

在受支持的 Harness 版本完成已有配置迁移前保留此迁移。Go 集成维护者确认该条件满足后移除。使用此版本 Harness 时，Penguin Go 必须已经支持 MMSP。
