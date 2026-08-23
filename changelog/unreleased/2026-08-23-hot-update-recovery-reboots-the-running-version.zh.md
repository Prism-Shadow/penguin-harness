# 启动失败的恢复现在重启真正在运行的那个版本

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`

[English](2026-08-23-hot-update-recovery-reboots-the-running-version.md)

推送的 platform 启动失败时，host 会从 park 文档
[重启上一个版本](2026-08-20-hot-update-failure-modes.zh.md)——但它判断该重启*哪一个* bundle 的
依据，是拿正在运行的 bundle 的 `id` 与打包默认版比较，不同时才回退去读 `harness.json`。这两个信号
都标识不了正在运行的版本。推送送过去的就是打包导出的那个 bundle，于是 `scripts/deploy.mjs` 构建出
的每一个 bundle 都带着打包版的 id，这个比较从未成立过；而 manifest 记的是最后写进磁盘的版本，只要
某次推送生效了却没能持久化，它就是另一个版本。

于是在一台部署过的机器上，一次失败的推送会把活着的进程退回到这台安装自带的 platform：那次部署新增
的端点不再应答，报出来的错误只有推送自己那一个，而下一次重启又会把它们带回来——运行中的代码和已提交
的代码不一致，却没有任何东西把这件事说出来。

现在恢复重启的是当时正在运行的那个 bundle，以已加载的对象持有、而不是重新推导出来，因此两种情况下
它按构造就是同一个版本。

## 细节

- host 会记录每一次成功启动背后的 platform bundle——打包默认版、从 `harness.json` 恢复的版本、推送
  的版本，一视同仁——启动失败的恢复就拿这个对象、配上内核交回的 park 文档重新启动。
- 恢复不再读 `harness.json`，也不再从 store 重新 import，所以对一个推送时报告 `persisted: false`
  的版本同样有效。
