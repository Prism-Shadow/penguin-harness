# penguin version 报告当前运行的是哪个构建

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `cli`, `core`, `server`, `docs`, `ci`
- **PR:** [#382](https://github.com/Prism-Shadow/penguin-harness/pull/382)

[English](2026-08-20-build-identity.md)

新增 `penguin version`，以单行输出当前构建的身份：发布版为 `v0.2.3`，源码 checkout 构建则为 `git describe --tags --dirty` 的结果，形如 `v0.2.3-14-g9e8f7d6-dirty`。`-v, --version` 输出同一行。`penguin version --json` 输出完整记录，`GET /api/version` 提供的正是同一份记录，因此两者不会对同一个安装给出不同说法。

## 细节

- core 新增 `buildInfo()`，作为 `BuildInfo` 记录的唯一生产者：`version`、`describe`、`channel`（`release` 或 `source`）、`buildDate`、`commit`、`branch`、`dirty`，以及记录 Node 版本、平台与架构的 `runtime` 块。CLI 与 version 路由只负责呈现，不添加任何自己的字段。
- 发布版的身份由常量携带：发布流程原本就打入 `VERSION` 与 `BUILD_DATE`，现在还会用 `GITHUB_SHA` 打入 tag 所在提交的 `BUILD_COMMIT`。发布产物与 npm 发布这两个打入任务都会写入，因此两条发布通道报告的是同一个提交。早于该常量的旧 tag、以及在 Actions 之外的重放，会尽可能打入，其余部分如实报告为未打入，而不是直接失败。
- 已安装的 penguin 从不执行 git，只读取这些常量。只有未打入的构建才会问 git，且只问自己被构建时所在的那个 checkout——从运行中模块自身所在目录逐级向上，寻找同时含有 `.git` 与 `pnpm-workspace.yaml` 的目录来定位。以模块而非工作目录为起点，正是「在别的仓库里执行 `penguin version` 仍报告 harness 自身版本」的原因；要求 workspace 标记存在，则避免了仅仅位于某个无关仓库之下的安装（例如家目录本身就是 dotfiles 仓库）报告出该仓库的提交。`.git` 为文件的 linked worktree 同样能被识别。
- 发布版的 `dirty` 是 null 而非 false：发布流程会先把常量写进工作区再构建，因此「是否干净」对发布产物本就不是一个属性。
- `scripts/test-installer.sh` 会把发布流程的打入代码块对着 fixture 重放，覆盖成功打入提交、无 `GITHUB_SHA` 运行、以及源码早于该常量的 tag 三种情形。

## 兼容性

`GET /api/version` 只增字段、未删字段；`version` 与 `buildDate` 含义不变，现有客户端不受影响。`VersionResponse` 改为 core 中 `BuildInfo` 的别名，对只读取原有两个字段的 TypeScript 消费方而言是一次放宽。
