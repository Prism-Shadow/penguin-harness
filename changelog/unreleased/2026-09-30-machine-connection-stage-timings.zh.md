# 连接一台机器的耗时按阶段可见

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`
- **PR:** [#981](https://github.com/Prism-Shadow/penguin-harness/pull/981)

[English](2026-09-30-machine-connection-stage-timings.md)

`GET /api/projects/:projectId/machines` 里的连接作业多了 `stages`：列出它跑过的每个连接阶段（`probe`、`start-server`、`reprobe`、`hold`、`sync-models`、`sync-plugins`），每项带 `startedAt`、`endedAt` 与 `ok`。连接用不到的阶段不列出。连接成功时，结果多一个 `connectedAt`，即连接被保持住的时刻。两个字段在 API 类型里是可选的，因为跑旧版服务端的机器不会带它们。

机器层的遥测跟随遥测开关。打开期间，下面这些样本进入服务端的遥测缓冲，以机器地址作 `keys.machine`：

- 每个连接阶段记一条 `machine.connect.stage` 样本，整次连接记一条 `machine.connect`，重新保持连接也算；
- 会话上的每条命令记一条 `machine.ssh.command`——从发起到答复，含退出码，超时单独标出——不含命令正文。

关着时每个采集点只做一次判断：不读时钟、不分配内存、不起定时器。`Telemetry` 机制多一个 `watch(listener)`：当即报告一次开关状态，之后每次变化再报。
