# CI 改为并行分片，不再是每个平台一个串行 job

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `ci`, `tooling`
- **PR:** [#488](https://github.com/Prism-Shadow/penguin-harness/pull/488)

[English](2026-08-27-ci-parallel-gates.md)

CI 此前把构建、代码风格、类型检查、测试、安装器与 e2e 作为六个串行步骤放在每个平台各一个 job 里，于是
每个平台都要按顺序把每道门都付一遍，整条流水线的长度由最慢的那个 job 决定——254 秒，其中最长的 job
有 138 秒花在 vitest 上、35 秒用来构建全部九个包，而那个 job 里的大部分包它根本不会加载。现在每道门
各自成为一个 job，单元测试按包分片。

## 细节

- 每个 job 只构建自己这一片会加载的包。这是实测出来的，而不是从依赖图上推出来的：server 的分片构建
  `@prismshadow/penguin-core...` 而非 `@prismshadow/penguin-server...`——后者会把 web 一并拽进来，
  因为 server 包需要交付 `web-dist`，而它的测试一个字节都不读。
- 覆盖范围不变。每个包的测试在每个平台上恰好跑一次，各平台的分片集合分别加总都等于仓库的 297 个测试文件。
- Windows 在按包分片之外，还把 core 与 server 两套测试再按 vitest 分片切开：那台 runner 光是准备工作
  就要 55–81 秒才轮得到第一个测试。ubuntu 与 macOS 保持整套不切。
- Windows 的安装器检查从测试矩阵中挪出、独立成 job：它此前挂在最长的那一片上，白给关键路径添了 20 秒。
- pnpm 改由 corepack 提供，不再用 `pnpm/action-setup`，并按 `packageManager` 中钉住的版本缓存
  corepack 拉取的压缩包。
- `ci` 成为汇总 job，依赖其余全部 job，这样分支保护只需要求这一个名字——分片列表变化时它依然成立。
- `style` job 会对所有 workflow 运行 `actionlint`。一个无法解析的 workflow 产生的 run 里一个 job 都没有，
  且在 run、check suite 与 commit status 三处都不留下任何注解。

## 不稳定的测试

- core 与 server 的 vitest 配置中加入 `retry`：Windows 重试两次，macOS 一次，Linux 不重试。这两套测试
  会派生真实 shell、驱动真实 pty，并在限时内读取输出，而这两台 runner 输掉这类竞争的比例是可测的——
  某一批重跑中，Windows 连续四次失败后又连续两次通过，失败的是四个**不同**的测试，而当次改动根本不可能
  影响行为。全部通过时重试不产生任何代价，真正的回归仍然每次都失败。
- 还有一类失败没有任何测试失败——worker 池拆解时抛出的 tinypool `ERR_IPC_CHANNEL_CLOSED`，此时所有
  文件都已报告通过——这超出了逐测试重试能覆盖的范围，因此 Windows 的测试步骤会把整条命令重试一次，
  并在重试时发出警告。
- `dangerouslyIgnoreUnhandledErrors` 能不花代价地消掉这个崩溃，但也会连真正的、仅在 Windows 出现的
  unhandled rejection 一起消掉，因此没有采用。
