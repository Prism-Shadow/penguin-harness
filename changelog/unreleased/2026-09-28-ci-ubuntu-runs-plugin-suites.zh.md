# ubuntu CI 分片运行插件套件，CI 要求的沙盒实时套件不再能跳过

- **Date:** 2026-09-28
- **Type:** process
- **Scope:** `ci`, `plugins/sandbox-bwrap`, `plugins/sandbox-dsh`, `plugins/sandbox-seatbelt`
- **PR:** [#872](https://github.com/Prism-Shadow/penguin-harness/pull/872)

[English](2026-09-28-ci-ubuntu-runs-plugin-suites.md)

ubuntu 的 `rest` 测试分片逐个点名所跑的包，因此 `plugins/` 下的所有包在 Linux 上都不跑测试，而 macOS 与 Windows 全部都跑。Linux 沙箱后端的实时套件（`sandbox-bwrap`、`sandbox-dsh`）在 Linux 以外的平台一律跳过，于是在哪个平台都没有执行。

## 详情

- ubuntu 的 `rest` 分片改为与 macOS、Windows 相同的「递归＋排除」写法：除 core、server、web、ui、cli（它们各有自己的分片）外全部运行。新增的包默认就会被调度，不再依赖有人记得把它列进去。构建清单与 macOS、Windows 的相同。
- `PENGUIN_MUST_RUN`（逗号分隔的套件目录名，即 `plugins/` 下的目录：`sandbox-bwrap`、`sandbox-dsh`、`sandbox-seatbelt`）声明一次运行必须真跑的环境相关套件。被点名的套件探测失败时判红并带出探测失败的原因，不再跳过；未点名的套件打不开时照旧跳过，拼错的名字同样如此。三个实时套件共用同一个检查 `scripts/must-run.mjs`。CI 在 `rest` 分片上设置它：ubuntu 为 `sandbox-bwrap,sandbox-dsh`，macOS 为 `sandbox-seatbelt,sandbox-dsh`。
- `sandbox-bwrap` 的测试自行把插件自带的 bubblewrap 取到位：在 Linux 上由 vitest 的 global setup 调用 `scripts/vendor-bwrap.mjs`（按 sha256 固定，缓存于 `node_modules/.cache`）。只跑测试也能测到用户拿到的那一个程序，CI 也不再为此构建该插件。该脚本判断产物已在位时，不再只看标记文件，还要求每个架构的 `bwrap` 都存在且可执行，因此构建也会修复受损的 vendor 目录。
- 该分片在测试前新增「Allow unprivileged user namespaces」一步，把 `kernel.apparmor_restrict_unprivileged_userns` 设为 0：Ubuntu 23.10 起只允许带 AppArmor 配置的程序创建非特权 user namespace，而自带的 bwrap 没有配置。
