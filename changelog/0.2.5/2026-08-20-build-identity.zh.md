# penguin version 报告当前运行的是哪个构建

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `cli`, `core`, `server`, `docs`, `ci`
- **PR:** [#382](https://github.com/Prism-Shadow/penguin-harness/pull/382)

[English](2026-08-20-build-identity.md)

新增 `penguin version`，以单行输出当前构建的身份：发布版为 `v0.2.3`，源码 checkout 构建则为 `git describe --tags --dirty` 的结果，形如 `v0.2.3-14-g9e8f7d6-dirty`。`-v, --version` 输出同一行。`penguin version --json` 输出完整记录，`GET /api/version` 提供的正是同一份记录，因此两者不会对同一个安装给出不同说法。

记录中的 `harness` 部分说明这台机器上被热更新推送的是什么，取自该数据根目录的 HMR store。推送过去的 bundle 落在任何 checkout 之外，因此它的 revision 会以两条路径抵达目标机器：构建时内联进产物本身，以及记录在其旁边的 `harness.json` 中。

## 细节

- core 新增 `buildInfo()`，作为 `BuildInfo` 记录的唯一生产者：`version`、`describe`、`channel`（`release` 或 `source`）、`buildDate`、`commit`、`branch`、`dirty`，以及记录 Node 版本、平台与架构的 `runtime` 块。CLI 与 version 路由只负责呈现，不添加任何自己的字段。
- 发布版的身份由常量携带：发布流程原本就打入 `VERSION` 与 `BUILD_DATE`，现在还会用 `GITHUB_SHA` 打入 tag 所在提交的 `BUILD_COMMIT`。发布产物与 npm 发布这两个打入任务都会写入，因此两条发布通道报告的是同一个提交。早于该常量的旧 tag、以及在 Actions 之外的重放，会尽可能打入，其余部分如实报告为未打入，而不是直接失败。
- 其余构建的 git 位置——描述、提交、分支、是否有未提交改动——由生成它的打包器内联进产物，取值来自同一个 `scripts/build-git-stamp.mjs`，接入 core、cli、desktop 的 tsup 配置以及 `scripts/deploy.mjs` 的 esbuild。构建产物没有任何回溯到其来源的路径：被推送到 `<root>/hmr/store/` 的 bundle 位于任何 checkout 之外，而工作目录给出的是用户自己仓库的答案。该 stamp 不含任何在相同源码的两次构建之间会变化的内容，因此 HMR store 的内容寻址依然能把未改动代码的重复推送归并为同一个条目。
- 内联的 stamp 优先于运行时询问 git，因为它描述的是正在执行的代码，而非其周围工作树此后的走向：位于已前进十个提交的 checkout 中的旧 `dist/`，报告的是它被构建时的 revision。
- 已安装的 penguin 从不执行 git，只读取这些常量。询问 git 只是未经打包运行（`tsx`、`vitest`、`pnpm dev`）时的兜底，且只询问运行中模块所在的那个 checkout——从其自身所在目录逐级向上，寻找同时含有 `.git` 与 `pnpm-workspace.yaml` 的目录来定位。以模块而非工作目录为起点，正是「在别的仓库里执行 `penguin version` 仍报告 harness 自身版本」的原因；要求 workspace 标记存在，则避免了仅仅位于某个无关仓库之下的安装（例如家目录本身就是 dotfiles 仓库）报告出该仓库的提交。`.git` 为文件的 linked worktree 同样能被识别。
- 发布版的 `dirty` 是 null 而非 false：发布流程会先把常量写进工作区再构建，因此「是否干净」对发布产物本就不是一个属性。
- `scripts/test-installer.sh` 会把发布流程的打入代码块对着 fixture 重放，覆盖成功打入提交、无 `GITHUB_SHA` 运行、以及源码早于该常量的 tag 三种情形。

## Harness 来源信息

- `scripts/deploy.mjs` 现在会填上升级协议本就带有的 `source`，取自它自身的 checkout：`revision` 的拼写与 `describe` 完全一致，包含 `-dirty`——从有未提交改动的工作区部署在这里是常态，而仅凭 sha 会指向一份从未存在过的代码。不在 git checkout 中发起的推送则不带 `source`，而非编造一个。
- `HmrHost.persistVersion` 会把该 `source` 连同 `pushedAt` 时间戳一并提交进 `harness.json`，使来源信息与它所描述的版本同行。升级路由仅在两个字段都是非空字符串时才接受 `source`——它现在会比请求活得更久，格式错误的记录会比产生它的那次推送活得更久。
- `hmr/manifest.ts` 中的 `readHarnessInfo` 以容错方式读回：字段缺失时退化为 null 而非抛错——用户为排查问题才执行的命令，不能反过来成为出错的那一个。在来源机制存在之前提交的版本，会带着 null 的 `source` 报告其 bundle 指针。
- `harness` 字段描述的是数据根目录的 store，而非上报它的进程。`penguin` 运行随包发布的 CLI，`penguin-hmr` 才运行 store 里的那份，因此 `harness` 非 null 本身并不意味着打印它的这条命令就是被推送的代码。
- 新增入口 `@prismshadow/penguin-server/version-report` 提供的 `versionReport()` 将 core 的 `buildInfo()` 与该读取器合并，CLI 与 version 路由都渲染它。任何一层都无法独自产出另一半：core 只了解制品、不了解数据根目录，store 只了解根目录、不了解读取它的进程。

## 兼容性

`GET /api/version` 只增字段、未删字段；`version` 与 `buildDate` 含义不变，现有客户端不受影响。`VersionResponse` 改为 core 中 `VersionReport` 的别名，对只读取原有两个字段的 TypeScript 消费方而言是一次放宽。

`harness.json` 新增两个可选字段。旧记录读回时 `source` 与 `pushedAt` 为 null，且不会被改写；也没有任何机制代其重新推送，因此某个根目录会一直报告 null 来源，直到它下一次热更新为止。无需迁移，也不执行任何迁移。
