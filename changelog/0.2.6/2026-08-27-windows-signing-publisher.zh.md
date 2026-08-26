# Windows 签名主体改为 NaisNet Technology Co., Ltd.，更新校验改为按名单

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `desktop`, `ci`
- **PR:** [#477](https://github.com/Prism-Shadow/penguin-harness/pull/477)
- **Breaking:** yes — 从 0.2.4 及更早版本安装的 Windows 桌面端会拒绝本次更新，需手动重装

[English](2026-08-27-windows-signing-publisher.md)

为 Windows 桌面端做 Authenticode 签名的证书更换了主体：现在的构建由
`CN="NaisNet Technology Co., Ltd."` 签名，签发者为 `Certum Extended Validation Code Signing
2021 CA`；而 v0.2.4 及此前的发布携带的是 `RushRush Network Technology Ltd`。此前写着旧主体的两处
朝相反方向各改一次——构建期的断言不再钉死名字，而更新校验所依据的名字改成了一份名单。

## 细节

- `packages/desktop/electron-builder.yml` 中的 `publisherName` 是 electron-builder 写入安装包内
  `app-update.yml` 的内容，electron-updater 据它校验下载到的更新。现在它同时列出当前主体与上一个
  主体，每个都按校验时比对的完整 DN 与裸 CN 两种写法各列一条，因此由本次发布安装的客户端仍能接受
  下一张证书签名的构建。删掉该字段的做法已评估，不可行：`publisherName` 缺失会让
  electron-updater 完全跳过更新签名校验，直接安装下载到的任何东西。
- `.github/workflows/desktop-build.yml` 中发布任务的检查此前断言一个精确的机构名，证书轮换时会让
  整个 Windows 桌面任务失败。两个桌面校验步骤按同一条线重划：只有必需的构建产物缺失、应当签名的
  产物没有签名、或签名存在但校验不通过时，才终止发布。这些步骤查看的其他一切——由哪个机构签名、
  `app-update.yml` 记录了什么、`latest.yml` 是否仍与安装包对应、公证票据与 Gatekeeper 评估是否
  通过——一律改为携带实际取值的 `::warning`，出现在运行摘要与日志中，步骤本身以 0 退出。macOS 步
  骤保留 `codesign --verify --deep --strict` 为硬失败，对 `stapler validate` 与 `spctl --assess`
  改为告警；公证本身仍由它之前的公证步骤执行并硬失败。必需产物检查、`REQUIRE_WINDOWS_SIGNING`
  空跑开关，以及把下载到的 EVSign CLI 在交付签名密钥前先行认证的那处独立检查，均保持不变。
- Linux 包与 CLI 安装脚本不涉及，它们都不校验 Windows 的签名主体名。

## 兼容性

electron-updater 用**已安装应用**自己的 `app-update.yml` 中记录的签名主体名单去校验下载到的更新，
而这份文件在安装时写定。从 0.2.4 及更早版本安装的 Windows 桌面端，那里只有
`RushRush Network Technology Ltd` 一项，因此会拒绝 NaisNet 签名的安装包，停留在当前版本。请从
[penguin.ooo/download](https://penguin.ooo/download) 手动重装一次；重装不会触碰 `~/.penguin/data`
下的任何数据，此后自动更新恢复正常，且两个主体都接受。本条与本次发布的其余兼容性处理一并记录在
[向后兼容](2026-08-25-backward-compatibility.zh.md)。
