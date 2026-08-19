# 依赖：hono ≥ 4.12.34（CORS 预检 ReDoS）

- **Date:** 2026-08-04
- **Type:** fix
- **Scope:** `server`
- **PR:** [#197](https://github.com/Prism-Shadow/penguin-harness/pull/197)

[English](2026-08-04-deps-hono-redos.md)

解决本仓库唯一一个开放的 Dependabot 告警：GHSA-8j4g-w8fx-2239 / CVE-2026-69207，Hono 的 `hono/cors` 中间件中一处中危 ReDoS——当 `allowHeaders` 未配置时，攻击者可控的 `Access-Control-Request-Headers` 预检头会触发正则的平方级回溯。server 包对 `hono` 的直接依赖范围从 `^4.8.0` 提升到 `^4.12.34`（首个修复版本，同一大版本）；lockfile 的改动限于 hono 依赖链，升级之后 `pnpm audit` 报告没有已知漏洞。
