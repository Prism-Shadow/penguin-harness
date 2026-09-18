# 完全访问也能断网

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** core, server, plugins
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[English](2026-09-16-full-access-network.md)

`danger-full-access` 在读取网络设置之前就短路为「不封禁」，于是「完全访问」悄悄丢掉了「断网」——权限按钮可能显示了一个并未生效的断网。

- **完全访问且网络放行**（且无屏蔽路径）时，仍是真正的不封禁。
- **完全访问且断网或屏蔽路径**时，现在会走到一个后端去执行这一维度，同时不限制文件系统。这是对沙盒契约的小幅放宽：provider 现在可能收到 `danger-full-access`，此时它必须放开文件、但仍要断网或隐藏路径。bwrap（无论在 Linux 上还是在 WSL 后端的发行版里）把根目录以读写方式绑定并仍 `--unshare-net`；Seatbelt 不拒绝任何写入但仍 `(deny network*)`。
