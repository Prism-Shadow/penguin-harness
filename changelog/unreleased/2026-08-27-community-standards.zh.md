# GitHub 期待的社区健康文件，全部收进 .github/

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `docs`, `tooling`

[English](2026-08-27-community-standards.md)

GitHub 的 Community Standards 页面此前列出五项未勾选——行为准则、贡献指南、安全策略、issue 模板、
Pull Request 模板。五项全部补齐，且凡是 GitHub 能从 `.github/` 内识别的文件都放在了那里，因此仓库根
目录没有新增任何东西，仍只保留 `README.md`、`CHANGELOG.md` 与 `LICENSE`。

## 细节

- `CONTRIBUTING.md` 从根目录**移动**到 `.github/CONTRIBUTING.md`（是重命名，不是复制），内容原样保留，
  仓库内相对链接上移一级重新锚定。文件顶部新增了指向行为准则与安全策略的指引，新增了一节讲如何提交
  缺陷报告或功能建议，并在 Pull Request 一节补上一条：标题用英文、`## Verification` 小节、以及模板。
  `README.md`、`README.zh.md`、`.github/workflows/release.yml` 与 `penguin-harness-dev` skill 均已
  指向新路径。
- `.github/CODE_OF_CONDUCT.md` 是 Contributor Covenant 2.1 的原文，执行联系方式填为
  <hiyouga@buaa.edu.cn>。其中文对应文件采用该公约官方的 zh-cn 译本，因此两份文件都不是转述，日后升级
  版本时也是一份干净的上游 diff。
- `.github/SECURITY.md` 把报告导向 GitHub 私密的 "Report a vulnerability" 表单，并以维护者邮箱作为
  兜底；同时说明只有最新发布版本受支持——项目尚未 1.0，代码从 `main` 出货，不做任何回移植。它还划出了
  这个产品需要的范围线：绕过审批、规避 `[command_policy]`、凭据落入日志或 Trace、以及 server 多用户
  边界被击穿属于范围内，而 Agent 在已批准的工具调用允许范围内所做的事属于既定设计。
- `.github/ISSUE_TEMPLATE/` 收录 `bug_report.yml` 与 `feature_request.yml` 两份表单 schema，外加一份
  `config.yml`：关闭空白 issue，并链接 Discord、文档站与安全 advisory 表单。缺陷表单会索取版本
  （`penguin version`）、安装形态、操作系统，以及问题是否在全新数据根目录上依然出现；两份表单与贡献
  指南都明确写出：配置文件、`.env` 或完整日志极可能夹带 Provider Key 或机器人 Token，不该出现在公开
  issue 里。
- `.github/PULL_REQUEST_TEMPLATE.md` 索取改动内容、一个写明实际运行了什么的 `## Verification` 小节，
  以及 `changelog/unreleased/` 下的中英成对 changelog 条目。
- 由报告者或新人（而非维护者）阅读的两份文档——行为准则与安全策略——随附 `.zh.md` 对应文件，贡献指南
  同样如此。由 GitHub 渲染的模板则没有：GitHub 既不会按语言挑选 issue 表单，也不会按语言挑选 Pull
  Request 模板，因此一份 `.zh` 副本要么被忽略，要么让 issue 选择列表里的条目翻倍。
