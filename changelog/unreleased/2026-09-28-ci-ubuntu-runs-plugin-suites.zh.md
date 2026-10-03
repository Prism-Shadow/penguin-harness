# ubuntu CI 分片运行插件套件，CI 要求的沙盒实时套件不再能跳过

- **Date:** 2026-09-28
- **Type:** process
- **Scope:** `ci`, `plugins/sandbox-bwrap`, `plugins/sandbox-dsh`, `plugins/sandbox-seatbelt`
- **PR:** [#872](https://github.com/Prism-Shadow/penguin-harness/pull/872)

[English](2026-09-28-ci-ubuntu-runs-plugin-suites.md)

ubuntu 的 `rest` 测试分片逐个点名所跑的包，因此 `plugins/` 下的所有包在 Linux 上都不跑测试，而 macOS 与 Windows 全部都跑。Linux 沙箱后端的实时套件（`sandbox-bwrap`、`sandbox-dsh`）在 Linux 以外的平台一律跳过，于是在哪个平台都没有执行。

## 详情

- ubuntu 的 `rest` 分片改为与 macOS、Windows 相同的「递归＋排除」写法：除 core、server、web、ui、cli（它们各有自己的分片）外全部运行。新增的包默认就会被调度，不再依赖有人记得把它列进去。构建清单与 macOS、Windows 的相同。
- `PENGUIN_MUST_RUN`（逗号分隔的套件目录名，即 `plugins/` 下的目录：`sandbox-bwrap`、`sandbox-dsh`、`sandbox-seatbelt`）声明一次运行必须真跑的环境相关套件。被点名的套件探测失败时判红并带出探测失败的原因（`sandbox-bwrap` 在 Ubuntu 上即点名 user namespace 开关），不再跳过；未点名的套件打不开时照旧跳过。每个套件只认自己的名字，因此拼错的名字会被忽略。CI 在 `rest` 分片上设置它：ubuntu 为 `sandbox-bwrap,sandbox-dsh`，macOS 为 `sandbox-seatbelt,sandbox-dsh`。
- `sandbox-bwrap` 的测试在插件自带的 bubblewrap 不在位时自行取到位：vitest 的 global setup 在 Linux 上调用 `scripts/vendor-bwrap.mjs`（按 sha256 固定，缓存于 `node_modules/.cache`）；已在位时什么都不做，非 Linux 上也什么都不做。只跑测试也能测到用户拿到的那一个程序，CI 也不再为此构建该插件。
- 该分片在测试前新增「Allow unprivileged user namespaces」一步，把 `kernel.apparmor_restrict_unprivileged_userns` 设为 0：Ubuntu 23.10 起只允许带 AppArmor 配置的程序创建非特权 user namespace，而自带的 bwrap 没有配置。
