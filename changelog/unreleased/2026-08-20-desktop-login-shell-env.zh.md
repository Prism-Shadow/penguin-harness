# 桌面版图形界面启动时导入登录 shell 环境变量

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`, `docs`
- **PR:** [#370](https://github.com/Prism-Shadow/penguin-harness/pull/370)
- **Issue:** [#351](https://github.com/Prism-Shadow/penguin-harness/issues/351)

[English](2026-08-20-desktop-login-shell-env.md)

让桌面版在 macOS 与 Linux 的图形界面启动时读取用户登录 shell 的环境变量：`.zshrc` / `.profile` 里 export 的 API key 能进入 core 的模型环境变量回退，agent shell 也拿到用户真实的 `PATH`——此前从 Dock / 桌面会话启动的应用看不到这些变量，用户被迫重复填写 key，agent 命令只能在系统裸 `PATH` 上运行。

## 细节

- 在任何代码读取 `process.env` 之前，外壳把用户的 `$SHELL` 以交互式登录 shell 跑一次，用哨兵标记框住 `env -0` 输出（NUL 分隔保住含换行的值，框定裁掉 rc 文件的杂音），然后**只补缺不覆盖**地合并——启动环境里已有的变量永远优先。内嵌 server 在 fork 时继承合并后的环境，agent shell 随之受益。
- `PATH` 是唯一做合并的键：登录 shell 的条目在前，启动环境独有的条目追加在后，并去重。
- shell 的簿记变量（`_`、`SHLVL`、`PWD`、`OLDPWD`、`TERM`）与 `ELECTRON_RUN_AS_NODE` 永不导入。
- 探测尽力而为，5 秒硬超时，任何失败都保持环境原样。从终端启动（`TERM` 已设置）与 Windows 完全跳过。设置 `PENGUIN_NO_LOGIN_SHELL_ENV` 可关闭导入。
- 让环境变量回退可见，且仅限官方 first-party 条目（官方 vendor 分组、catalog 形态未被改动——网关、custom 与自定义分组一律排除，避免把官方 `OPENAI_API_KEY` 引向转售端点）：未配置存储 key 且检测到变量时，卡片的 key 槽位与模型详情都以存储 key 相同的规则显示该变量取值的掩码，详情里「创建时间」的位置改写为「读取自环境变量」，且不提供清除项；存入 key 仍按既有优先级覆盖变量。models API 在 `envKey` 旁新增 `envKeyMasked`——只下发掩码预览，明文绝不序列化。
- 收窄「留空则由环境变量兜底」这类提示——模型详情里 API key 的 placeholder、其下方的默认端点说明，以及整组配置 key 对话框的 placeholder——只在服务端确实读到了值的变量上出现。知道某个 provider 读哪个变量，并不等于那个变量被设置过；此前的提示会在变量为空的机器上劝用户留空，结果模型一个 key 都没有。
- 已写入桌面版速上手与配置参考文档。
