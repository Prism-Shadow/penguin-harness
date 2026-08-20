# 桌面版图形界面启动时导入登录 shell 环境变量

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `desktop`, `docs`
- **Issue:** [#351](https://github.com/Prism-Shadow/penguin-harness/issues/351)

[English](2026-08-20-desktop-login-shell-env.md)

让桌面版在 macOS 与 Linux 的图形界面启动时读取用户登录 shell 的环境变量：`.zshrc` / `.profile` 里 export 的 API key 能进入 core 的模型环境变量回退，agent shell 也拿到用户真实的 `PATH`——此前从 Dock / 桌面会话启动的应用看不到这些变量，用户被迫重复填写 key，agent 命令只能在系统裸 `PATH` 上运行。

## 细节

- 在任何代码读取 `process.env` 之前，外壳把用户的 `$SHELL` 以交互式登录 shell 跑一次，用哨兵标记框住 `env -0` 输出（NUL 分隔保住含换行的值，框定裁掉 rc 文件的杂音），然后**只补缺不覆盖**地合并——启动环境里已有的变量永远优先。内嵌 server 在 fork 时继承合并后的环境，agent shell 随之受益。
- `PATH` 是唯一做合并的键：登录 shell 的条目在前，启动环境独有的条目追加在后，并去重。
- shell 的簿记变量（`_`、`SHLVL`、`PWD`、`OLDPWD`、`TERM`）与 `ELECTRON_RUN_AS_NODE` 永不导入。
- 探测尽力而为，5 秒硬超时，任何失败都保持环境原样。从终端启动（`TERM` 已设置）与 Windows 完全跳过。设置 `PENGUIN_NO_LOGIN_SHELL_ENV` 可关闭导入。
- 已写入桌面版速上手与配置参考文档。
