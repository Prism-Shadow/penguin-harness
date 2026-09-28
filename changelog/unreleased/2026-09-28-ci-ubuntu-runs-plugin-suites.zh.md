# ubuntu CI 分片运行插件套件

- **Date:** 2026-09-28
- **Type:** process
- **Scope:** `ci`

[English](2026-09-28-ci-ubuntu-runs-plugin-suites.md)

ubuntu 的 `rest` 测试分片逐个点名所跑的包，因此 `plugins/` 下的所有包在 Linux 上都不跑测试，而 macOS 与 Windows 全部都跑。Linux 沙箱后端的实时套件（`sandbox-bwrap`、`sandbox-dsh`）在 Linux 以外的平台一律跳过，于是在哪个平台都没有执行。

## 详情

- ubuntu 的 `rest` 分片改为与 macOS、Windows 相同的「递归＋排除」写法：除 core、server、web、ui、cli（它们各有自己的分片）外全部运行。新增的包默认就会被调度，不再依赖有人记得把它列进去。
- 该分片构建 `sandbox-bwrap`，使其实时套件用插件自带（vendored）的 bwrap 做围堵，而不是 runner 的 PATH 上的那一个。
- 测试之前新增一步：为该分片解除 Ubuntu 24.04 的 AppArmor 对非特权 user namespace 的限制，并打印主机的 user namespace 设置与 `bwrap` 路径，以便区分「实时套件被跳过」与「产品侧拒绝」。
