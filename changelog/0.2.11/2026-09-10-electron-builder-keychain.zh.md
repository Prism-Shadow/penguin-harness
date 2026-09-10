# macOS 安装包恢复签名：electron-builder 升至 26.16.1

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `desktop`, `ci`
- **PR:** [#669](https://github.com/Prism-Shadow/penguin-harness/pull/669)

[English](2026-09-10-electron-builder-keychain.md)

桌面端改用 electron-builder 26.16.1 构建（原为 26.15.3）。旧版本解锁临时签名钥匙串时误用了证书的导入
密码而非钥匙串自己的密码，钥匙串已解锁时 macOS 过去并不计较；2026-09-08 发布的 GitHub 运行器镜像不再
容忍这一点，于是每次签名的 macOS 构建都在 `security set-key-partition-list` 处以「用户名或密码不正确」
失败。26.16.1 带有上游修复
（[electron-builder #10066](https://github.com/electron-userland/electron-builder/issues/10066)）。
安装包本身没有任何变化。
