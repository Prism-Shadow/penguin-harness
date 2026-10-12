# 向后兼容：只报告一个推荐沙盒后端的远程机器

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `web`
- **PR:** [#978](https://github.com/Prism-Shadow/penguin-harness/pull/978)

[English](2026-10-03-backward-compatibility-sandbox-recommended.md)

[沙盒卡片](2026-10-03-sandbox-landlock-floor.zh.md)把所显示机器的 `backend.recommended` 读作包的列表。此改动之前的服务端只报告一个包，形式为单个字符串。

## 旧形态：`recommended` 为字符串

卡片显示一台运行较旧服务端的远程机器时，Web App 把该字符串读作只含一个包的列表，打开开关时提示安装这个包。没有这层处理，字符串会被拆成单个字符，每个字符都被当作一个包提示安装。只影响 Web App，不涉及任何存储。**用户无需任何操作。**

## 何时可以移除

兜底是 `packages/web/src/lib/sandbox-backend-prompt.ts` 中的 `recommendedOf`，标有 `TODO(recommended-string-compat)`。当 Web App 能显示的每台机器都运行报告列表形式的服务端时，即不再为远程机器支持此改动之前的版本时，即可移除。
