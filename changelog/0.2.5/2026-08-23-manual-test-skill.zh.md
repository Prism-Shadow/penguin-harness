# 一个用于把应用跑起来、供人工验证的 skill

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`, `docs`
- **PR:** [#428](https://github.com/Prism-Shadow/penguin-harness/pull/428)

[English](2026-08-23-manual-test-skill.md)

`.agents/skills/penguin-harness-manual-test/SKILL.md` 是一个新增的仓库开发 skill，讲述如何在开发机上把应用跑起来、以便动手验证一处改动：四个开发入口
（`pnpm dev`、`pnpm desktop`、`pnpm dev:landing`、`pnpm dev:docs`）及其固定端口，以及那些会让正常环境显得像是坏掉了的
环境陷阱。另有两份相邻文档被一并校正，以与之保持一致。

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
- `CONTRIBUTING.md` 关于数据根目录的那一段现在要求贡献者只为需要它的那条命令内联传入 `PENGUIN_HOME`，而不是 export
  它，并写明了「仅在未设置或为空时才生效」这条规则如何让 export 出去的值胜出，以及 export `~/.penguin/data`
  会造成什么样的冲突。
- `penguin-harness-dev` 删去了「远端存在一个名为 `docs` 的分支，因而本仓库无法创建 `docs/<topic>` 分支名」这一说法：
  远端并不存在这样的分支，带斜杠的形式可以正常推送。那段时期遗留下来的 `docs-<topic>` 命名在规则所在处一并说明，
  并给出 `git ls-remote --heads origin` 作为日后复现时的排查手段。

## 被覆盖时会说出来

`scripts/run-with-env.mjs` 仍然把 `VAR=value` 参数当作默认值——继承来的值依旧优先，这正是
`PENGUIN_HOME=/somewhere pnpm dev` 得以生效的前提，因为子进程无法区分命令内联赋值与 shell 导出。
改变的是它不再悄无声息：任何被环境顶掉的默认值，都会在命令运行前打印到 stderr，因此一个全局导出
再也无法在无人察觉的情况下把开发脚本指向另一个数据根。

