# 向机器交接构建时带上原生资产

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `server`
- **PR:** [#549](https://github.com/Prism-Shadow/penguin-harness/pull/549)

[English](2026-08-30-machines-handover-assets.md)

连接一台机器时,本 server 会通过那台机器自己的更新通道把热推的构建交接过去。交接体原先只带 platform、CLI 和 web 三样,丢掉了原生资产——因此以这种方式收到构建的机器,其平台无处解析 `node-pty`,在它上面打开的每个终端都以 `node-pty is unavailable to the platform … no assets directory available` 失败,而同一份构建用 `deploy.mjs` 直推却正常。

## 细节

- 交接体现在把已落地的资产目录按推送时的原样重新打包——所有文件,exec 位取自文件 mode——连同记录的出处(`source`)一起发送,于是机器从连接收到的和从直推收到的是同一个版本。
- 推送时本就没有资产的构建仍照旧交接。
