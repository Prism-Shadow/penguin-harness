# dev CLI 使用独立数据根，与 `pnpm dev` 并行共存

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `tooling`, `core`, `cli`
- **PR:** [#471](https://github.com/Prism-Shadow/penguin-harness/pull/471)

[English](2026-08-26-agent-env-hygiene.md)

`pnpm penguin` 改用独立的默认数据根 `~/.penguin/dev-data-cli`，把它的端口（7369）开始的隔离补齐。
一个数据根同时只允许一个 server（`<root>/server.lock`），因此在共享的 `~/.penguin/dev-data` 上，
dev CLI 的 `penguin web` 与 `pnpm dev:server` 只能交替运行——而以 `pnpm penguin web` 启动的
harness 恰恰就是那个会让 Agent 在本仓库里运行 `pnpm dev` 的实例。拆分之后，该 Agent 的
`dev:server` 可以正常启动，不再对着 harness 自己持有的锁以退出码 3 收场。

## 细节

- `packages/core/src/internal/ports.ts` 的分配表增加了数据根一列，并补记桌面端的端口行为
  （无固定端口；粘滞的 `PORT=0` 分配）与 web e2e harness 的端口和一次性数据根，两类问题在同一处
  得到回答。
- CLI 包新增 `dev-entry-isolation` 测试，钉住各（端口, 数据根）组合的两两不相交——这些赋值都写在
  package.json 脚本行上，没有任何类型检查覆盖——同时钉住根目录与 `packages/cli` 两处 `penguin`
  脚本的赋值保持一致。
- 桌面端 dev shell 刻意留在 `~/.penguin/dev-data`：对已加锁数据根再起一个 server 属于它的附着模式
  而非启动失败，且交替使用的 `pnpm dev` 与 `pnpm desktop` 共享同一份数据正是共用数据根的意义所在。
  测试同样钉住了这一选择。
- 两个回归测试钉住了此前没有本地覆盖的环境保证：stdio MCP server 永远看不到服务进程自身的
  `PENGUIN_*` / `PORT`（其子进程环境 = MCP SDK 安全继承白名单 + 条目自身 `env`——与
  [命令环境剥离](2026-08-24-agent-commands-own-data-root.zh.md)以相反机制达成同一结果）；在该剥离
  之后显式注入的变量对任何 `PENGUIN_*` 名称一律以注入值为准——这正是 Agent vault 今天所用、后续
  任何注入层也将依赖的组合边界。

## 兼容性

贡献者需要一次性迁移：`pnpm penguin` 此前运行在 `~/.penguin/dev-data` 上，经它创建的 Agent 与
Session 不再出现在它的窗口中——磁盘上的数据本身原样保留、不受影响。要把 dev CLI 命令指向
`pnpm dev` 的数据集，按命令显式声明（`PENGUIN_HOME=~/.penguin/dev-data pnpm penguin config model
list`，或在支持处使用 `--root`）。已安装的入口与两种桌面形态均不受影响。
