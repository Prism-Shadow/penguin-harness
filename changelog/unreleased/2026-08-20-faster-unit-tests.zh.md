# 更快的单元测试套件，以及不再誊写文案的断言

- **Date:** 2026-08-20
- **Type:** process
- **Scope:** `server`, `core`, `web`, `skills`, `tooling`

[English](2026-08-20-faster-unit-tests.md)

`pnpm -r test` 的中位耗时从 64.7 秒降到 38.7 秒，server 包——工作区的依赖顺序把它放在关键
路径上——从 51.5 秒降到 13.4 秒；数据取自一台 8 核 Linux 机器上交替执行的五轮改前/改后测量。
两处改动带来了这个结果：测试中密码哈希改用极低的 scrypt 开销，以及 server 的 vitest worker
在它负责的多个文件之间保留模块注册表。另有一轮清扫，把誊写自发布文档与 i18n 词典的断言换成了
它们背后真正的不变式。

## 测试中的密码哈希

- `hashPassword` 把 scrypt 的开销因子改成带默认值的参数，`buildAppDeps` 在原有的 `loader` /
  `titles` / `updateCheck` 测试替身之外新增 `passwordHashCost` 覆盖项。服务端的测试 helper
  传入合法的最小因子。生产路径不传这个参数，而 `buildAppDeps` 不在包的 `exports` 里，任何
  配置都够不到它。
- 两种情况下存储格式、记录的参数与校验路径完全一致：因子写在哈希串内部，`verifyPassword`
  按写入时的开销重新推导，已经落盘的哈希照常校验通过。
- `password.test.ts` 调用不带参数的形式，并新增断言：生产开销因子为 16384——要调低默认值，
  就得先动这个测试。

## Worker 隔离

- `packages/server/vitest.config.ts` 设置 `isolate: false`，worker 在它负责的多个文件之间保留
  模块注册表。该套件里每个文件都会导入整个 app 依赖图，其中包含 core 的产物包。fork 的创建
  次数从每个测试文件一次降为每个 worker 一次。
- 进程池仍是 `forks`：`process.env` 是进程级的，而这里有若干文件会修改并还原它，换成线程池
  会让它们互相竞争。
- 同一份配置设置了 `restoreMocks: true`：某个 spy 的行内 `mockRestore()` 若被它上方失败的断言
  跳过，也不会在该 worker 余下的运行里一直生效。
- `packages/server/test/isolation.test.ts` 会在套件中任何文件注册模块 mock 时失败——那是共享
  注册表唯一无法容忍的东西，也是出事后会在无关文件里显形的那一种。

## 誊写文案的断言

- `packages/skills`：三个测试固定了约 140 条来自 `benchmark-design`、`agent-evaluation`、
  `agent-optimization` 与 `remote-claude-code` 的原句。改为五个测试，只固定 agent 会执行的
  东西——启动语句及其 CLI 参数、tmux 命令、Evaluator 协议的块标量与不该出现的 `max_score`
  ——以及这些文档依赖的章节先后顺序。
- `packages/web`：kernel 字段标签、记忆对话草稿、压缩标题与导航开关名称改为经由词典断言，而不是
  誊写词典的值；kernel 标签测试的覆盖面也从两个键扩大到两份词典的全部键。示例任务草稿保留参数
  标记、禁止出现的标记与长度上限，场景文案可以自由改动。
- `packages/core`：默认系统提示词的护栏测试保留了改写不得触碰的部分——不出现服务端口号、不出现
  vault CLI 命令——以及把重试规则固定在 `# Stop rules` 之内的顺序断言。
- `packages/cli`：探活失败的防火墙提示改为检查其中是否含端口号、以及是否与连接被拒的提示不同，
  而不是把这句话的两种译文都写死。
