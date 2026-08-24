# 一个用于在本地启动并驱动应用的 skill

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`
- **PR:** [#428](https://github.com/Prism-Shadow/penguin-harness/pull/428)

[English](2026-08-23-local-run-skill.md)

`.agents/skills/penguin-harness-run/SKILL.md` 是一个新增的仓库开发 skill，讲述如何在开发机上把应用跑起来：四个开发入口
（`pnpm dev`、`pnpm desktop`、`pnpm dev:landing`、`pnpm dev:docs`）及其固定端口，以及那些会让正常环境显得像是坏掉了的
环境陷阱。

## 细节

- 逐个入口写明数据根目录：`resolveRoot()` 是 `PENGUIN_HOME ?? ~/.penguin/data`，而 `desktopDataRoot()` 让打包版走向同一个
  与 CLI 共享的根目录，只有未打包的运行才使用 `~/.penguin/dev-data`。该 skill 同时指出启动时报告实际根目录的那几行
  （`Data root: <root>`、`[shell] dev instance '<name>' on data root <root>`）。
- `scripts/run-with-env.mjs` 以 `${VAR:-value}` 的语义施加 `VAR=value`，因此每一个开发默认值都只是默认值，继承而来的
  `PENGUIN_HOME` 会无声地胜出。该 skill 给出的规则是：永远不要 export 它；需要独立的根目录时，只为单条命令加前缀
  （`PENGUIN_HOME=~/.penguin/dev-data-<topic> pnpm dev`）。此外还写明了空值在该脚本与 `resolveRoot()` 的 `??` 之间造成的不对称。
- `<root>/server.lock` 使一个数据根目录只接纳一个服务端，重复启动会以
  `Another PenguinHarness server is already running on this data root (pid N)` 拒绝并以 3 退出，换 `PORT` 也无济于事。
  给出的做法是换一个独立的根目录，而不是去杀掉那个通常属于用户自己的桌面端。
- 环境代理会把指向 loopback 的 `curl` 也送进代理并返回 502，而服务端其实完好无损；浏览器与服务端自身的出站链路都不受影响。
  该 skill 给出了 `curl --noproxy '*'` / `NO_PROXY`，并要求在调试服务端之前先怀疑代理。
- 另有两处同样会被读作故障的表现：`127.0.0.1` 上的 `/api` 是 Workspace 预览主机，按设计返回 401；7368 上的开发后端提供的是
  上一次构建出的 `packages/web/dist`，而不是 Vite 正在 7365 上提供的内容。
- 为脚本化运行覆盖了登录：种子 `admin` 的提示框、`<root>/initial-admin-password`、`PENGUIN_SEED_ADMIN_PASSWORD`，以及在没有
  模型凭据的根目录上用 `packages/web/e2e/` 测试设施驱动对话流程。
