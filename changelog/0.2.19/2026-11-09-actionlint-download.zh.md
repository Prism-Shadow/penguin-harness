# 为 actionlint 下载增加重试和 Release API 备用地址

- **Date:** 2026-11-09
- **Type:** process
- **Scope:** `ci`
- **PR:** [#1484](https://github.com/Prism-Shadow/penguin-harness/pull/1484)

[English](2026-11-09-actionlint-download.md)

为 CI 中的 actionlint 下载增加了重试，并在失败时改用 GitHub Release API。下载的压缩包通过固定 SHA-256 校验后，才会解压并执行。
