# 插件安装失败时显示 npm 的错误，而不是它先打印的警告

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`

[English](2026-11-26-npm-failure-text-skips-warnings.md)

npm 安装或查询插件失败时，服务端会显示 npm 标准错误输出里第一条有内容的行，而 npm 以低于 error 的级别输出的行可能占据这个位置：`.npmrc` 里有 npm 不认识的键（例如 `always-auth`）时，npm 每次运行都会先打印 `npm warn Unknown user config "always-auth"`，于是这条警告成了失败信息。现在服务端跳过 npm 以较低日志级别作前缀的行（`npm warn`、`npm notice`，以及调高 loglevel 后多出的 `http`、`info`、`verbose`、`silly`、`timing` 行），显示 npm 的错误；只有 npm 除此之外什么也没输出时，才显示一条警告。失败属于哪一类、npm 提到的是哪个 registry，仍从完整输出中读取。
