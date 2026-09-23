# 停着的机器会被先启动，再把构建交给它

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#TBD](https://github.com/Prism-Shadow/penguin-harness/pull/TBD)

[English](2026-09-23-handover-starts-server.md)

Enable 一台程序已是当前版本、但 server 没在跑的机器时，会把它记成「已在此版本」，而实际上什么都没送过去：交接
走的是运行中 server 的更新通道，server 不在就无处可交。此后「use」只看自己的记录，报「already on」然后什么也不做——
机器一直跑着旧构建，而只有失败的任务才会提供的强制安装也无从触发。

## Details

- 交接时发现 server 没在跑，现在会先把它启动，再像对任何运行中的 server 一样把构建交给它，拒绝也照样报出来。
  启动不了则任务失败，并提供强制安装。
- 「use」不再信任安装记录：总是先问机器上有什么（安装器自己的探测，一次 ssh 往返），只有机器自己说是当前版本才报
  「already on」。
