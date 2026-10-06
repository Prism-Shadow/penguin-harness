# deploy.mjs 遇到目标已有的同一构建时不再推送

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `tooling`, `server`, `core`
- **PR:** [#990](https://github.com/Prism-Shadow/penguin-harness/pull/990)

[English](2026-09-30-deploy-skips-the-same-build.md)

`scripts/deploy.mjs` 推送前先读目标的 `GET /api/version`；目标已提交的恰是这一构建时就停下，不再让它把同一个平台再 import 一遍、多出一代。

## 细节

- platform、cli、web、assets 四个指针按运行时给 store 文件命名的同一规则，由将要发送的字节重新算出，四个都与已提交的相同才算同一构建；此时脚本打印 `the target already has this build … nothing pushed` 并以 0 退出。
- 其余情况照旧推送：拿不到报告、目标从未被推送过、任一指针不同，或目标平台的报告还不含 assets 指针。
- `--force` 跳过比对照推。
- 版本报告（`GET /api/version`、`penguin version --json`）新增 `harness.assets`：已提交的原生资产目录，相对 `<root>/hmr`；该版本不带资产时为 null。
