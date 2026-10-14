# 从安装包中移除工作区标记

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `ci`
- **PR:** [#1124](https://github.com/Prism-Shadow/penguin-harness/pull/1124)
- **Issue:** [#1119](https://github.com/Prism-Shadow/penguin-harness/issues/1119)

[English](2026-10-14-packaged-cli-shim.md)

在依赖安装完成后，从 Docker 镜像和发布包中删除了 `pnpm deploy` 生成的 `pnpm-workspace.yaml`，避免打包服务将安装目录误认成源码仓库、向 `<data root>/bin/penguin` 写入报错脚本。

## 细节

- 增加了 Docker 冒烟检查：使用已有报错脚本的数据目录启动服务，验证脚本被移除，再将 `/data/bin` 放在 `PATH` 首位运行 `penguin --version` 和 `penguin browser --help`。
