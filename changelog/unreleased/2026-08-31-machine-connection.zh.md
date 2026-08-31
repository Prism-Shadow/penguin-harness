# 对机器的一切言语都经由同一个连接接缝离开

- **Date:** 2026-08-31
- **Type:** refactor
- **Scope:** `server`, `web`
- **PR:** [#562](https://github.com/Prism-Shadow/penguin-harness/pull/562)

[English](2026-08-31-machine-connection.md)

从前和机器说话有四扇门——共享 shell、持有的 forward、安装每一步新开的 ssh/scp、状态探测兜底的一次性 ssh。每扇门都凭自己通道的状态判断机器的死活,判断可以互相矛盾——connect 死循环正是从这片土壤里长出来的。现在一切都经由那台机器的 `MachineConnection` 离开,机器列表里的活性事实也改为点名它测量的层次。

## 细节

- 新目录 `machines/transport/`:`exec.ts`、`ssh-session.ts`、`forward.ts`、`targets.ts` 移入并私有化;唯一的门是 `transport/index.ts`,导出 `MachineConnection` 句柄(`exec` 走共享 shell,`oneShot` 承担长步骤与 stdin 载荷,`pipeTo` 流式传输,`copyTo` 走 scp,`forward` 是持有的隧道),以及目标解析和结果词汇。
- 保证的是**权威**而非 socket 数:底下存在哪些 socket 从此是一个目录的实现细节,将来可以向字面意义的单连接多路复用收紧而调用方毫无感知。源码扫描测试(`machines-transport-boundary.test.ts`)钉住边界:目录之外没有人 spawn ssh/scp,也没有人越过 index 伸手进来。
- 状态探测的一次性 ssh 兜底删除——其通道参数改为必填,探测永远搭调用方的共享 shell,不再对机器张开第二张嘴。
- `MachineInfo.connected` 删除:这个布尔实际测量的是"本侧的 ssh forward 子进程活着",却被当成"机器可用"来读——正是 connect 死循环背后的误读。字段改为事实本身:`forward: { localPort } | null`,local 条目恒为 `null`;至于那边的 server 是否**应答**,仍由 `status`(探测层,本就携带 `state` + `checkedAt`)说话。想表达"可用"的消费者从此无法在读传输层的同时通过类型检查。第三层——"机器的 API 在 t 时刻应答过"——有意暂不加入:今天 server 侧没有任何人测量它;它将随机器健康状态机到来,即本线的下一步。
- 其余行为不变:句柄无状态(每台机器的状态仍在按地址键控的注册表里),测试所伪造的 `MachinesEffects` 接缝原地未动。
