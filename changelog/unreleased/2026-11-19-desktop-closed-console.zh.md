# 启动器关闭后，桌面应用仍可记录日志

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `desktop`
- **Issue:** [#1604](https://github.com/Prism-Shadow/penguin-harness/issues/1604)

[English](2026-11-19-desktop-closed-console.md)

在 Linux 上，启动器停止读取终端输出后，桌面应用仍可正常运行。桌面端和内置服务的消息会继续写入应用数据目录下的 `logs/desktop.log`。
