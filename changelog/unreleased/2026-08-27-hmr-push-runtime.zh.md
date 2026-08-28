# 推送也带上 runtime，下次启动时生效

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `tooling`

[English](2026-08-27-hmr-push-runtime.md)

热更新推送一直带着 platform、CLI 和 web dist，唯独带不了 runtime——那个执行前三者的服务器本身——所以一台机器的 runtime 只能靠安装已发布的 release 前进。`POST /api/hmr/upgrade` 现在接受第四件产物 `runtime`，与其余一同提交到 store，在下次启动时被采纳。

## 细节

- runtime 是接收方进程唯一无法当场采纳的产物：它**就是**那个进程。所以它被内容寻址进 `store/runtime/`，由 `harness.json` 新增的 `runtime` 字段指向；打包的入口在其它任何事情之前先问 `hmr/launch.ts`——store 里指了哪个，就 import 哪个，那个 bundle 成为这个进程。
- 推送带来的 runtime 若不是当前进程正在跑的那个，结果里 `restartRequired: true`，与 `persisted` 并列。推送在磁盘上已完成、在效果上待生效；不会自行重启，因为重启会断掉这台服务器正持有的每一个连接。`scripts/deploy.mjs` 在收尾那行直接说出来。
- 不带 runtime 的推送保留已提交的指针。丢掉它会让机器在下次启动时退回打包的 runtime——一次没有人要求过的降级。
- 加载器里每一种失败都退回打包的 runtime 并说明原因：文件不存在、manifest 指向 store 之外的路径、bundle 在 import 时抛错。CLI 加载不了自己的 bundle 可以直接退出；服务器起不来则是一台什么都不服务的机器，所以一次推送绝不能让服务器下线。

## 兼容性

`runtime` 双向可选。旧的推送方不发这个字段，其推送行为与之前完全一致；没有这项改动的服务器会忽略它。`harness.json` 里没有 `runtime` 条目的数据根启动它打包的 runtime——也就是今天每个数据根的行为。
