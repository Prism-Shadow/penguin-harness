# 通过明文 HTTP 访问时，「+」按钮也能把已输入的草稿存入列表

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`

[English](2026-09-11-random-id-insecure-context.md)

草稿会话与用户快捷方式的 id 改由 `crypto.getRandomValues` 生成，不再使用 `crypto.randomUUID`。后者只在安全
上下文（HTTPS 或 localhost）中存在，因此以明文 HTTP 从 localhost 以外的任何地址打开 Web App 时，一旦需要把
已输入的草稿存入列表——即草稿里有文字时点击「+」——就会抛出 `crypto.randomUUID is not a function`，且只要
文字还在，之后每次点击都同样失败。id 的形态保持不变：`draft-` 后接 8 位十六进制，`sc-` 后接 12 位。
