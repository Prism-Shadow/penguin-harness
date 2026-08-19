# 工具链：Release 产物的阿里云 OSS 分发

- **Date:** 2026-08-03
- **Type:** feature
- **Scope:** `tooling`, `ci`, `docs`
- **PR:** [#166](https://github.com/Prism-Shadow/penguin-harness/pull/166)

[English](2026-08-03-oss-distribution.md)

发布下载不再只依赖 GitHub 的可达性（[#166](https://github.com/Prism-Shadow/penguin-harness/pull/166)）。

- 新增的 `mirror-oss` 发布任务会下载附加在 GitHub Release 上的那些确切产物，重新校验它们的校验和，并把同样的字节镜像到阿里云 OSS 存储桶；`latest.json` 最后上传，且只在每个产物都落地之后才上传，因此镜像绝不会对外宣告一个只镜像了一半的版本。该任务从 `oss-production` 环境读取其 provider/role ARN 与存储桶设置，缺任何一项都会带具名错误快速失败。
- `install.sh` / `install.ps1` 新增下载源开关：`PENGUIN_DOWNLOAD_SOURCE=auto`（默认）优先使用 OSS 镜像，并在镜像不可用时回退到 GitHub 上的同一版本；`oss` 与 `github` 则固定使用其中一个源。`PENGUIN_DOWNLOAD_BASE_URL` / `PENGUIN_DOWNLOAD_FALLBACK_BASE_URL` 可直接覆盖产物目录（经 https 校验），而下载进度会写明它实际正在使用的源。
- 一个 `oss-staging` 工作流，加上 `scripts/publish-release-to-oss.sh`、`scripts/install-ossutil.sh` 与 `scripts/test-oss-staging.sh`，在进入生产之前端到端演练整条镜像路径；而封闭式的安装脚本测试在两个平台上都覆盖了这个源开关。
- 安装文档以两种语言记录了下载源这一行。
