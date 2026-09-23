# 推送的平台能在早于 Penguin Go origin 的运行时上启动

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `server`

[English](2026-09-23-platform-claims-older-runtimes.md)

热推只替换平台，从不替换运行时，所以平台必须能在每一个已安装的运行时上启动。此前 `penguinGoOrigin` 被加进了平台向运行时索取的必需配置成员，导致推到早于它安装的运行时一律失败：`this runtime publishes no business capabilities this platform can claim (config: missing penguinGoOrigin)`，而且每次被拒的推送仍会重启服务器。

- 把 `penguinGoOrigin` 移出必需配置成员。`penguinGoOrigin` 与 `modelscopeBridgeUrl` 在服务端配置上改为可选，与 `cliEntry` 同理：运行时没有发布它们时，Penguin Go 与 ModelScope 授权提供者使用生产默认值（`https://token.penguin.ooo`、`https://go.penguin.ooo/modelscope`）。
- 新增测试钉住这条规则：运行时发布之后才加入的配置成员绝不进入必需列表。
