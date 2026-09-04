# 官方 Docker 镜像，由发布 workflow 推出

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `ci`, `tooling`, `docs`
- **PR:** [#609](https://github.com/Prism-Shadow/penguin-harness/pull/609)

[English](2026-09-04-official-docker-image.md)

PenguinHarness 新增官方容器镜像 `ghcr.io/prism-shadow/penguin-harness`，由发布 workflow 中新增的 `docker` job 推出 `linux/amd64` 与 `linux/arm64` 两个架构，tag 为 `X.Y.Z`、`X.Y`，以及在该 tag 仍是 GitHub 当前 latest Release 时的 `latest`。它在 `0.0.0.0:7364` 上运行 `penguin server`，数据目录落在 `/data` 卷上，因此一次部署就是一个容器加一个卷。

## 细节

- 镜像安装的是已发布的 npm 包：`PENGUIN_VERSION` 构建参数选定版本，构建上下文里除入口脚本外别无他物。构建阶段为 `node-pty` 装上 `python3 make g++`——它不提供 Linux 预编译产物，因此每次 Linux 安装都要现编；运行阶段只把编译好的包树拷出来，从不安装编译器。
- 基础镜像为 Ubuntu 24.04 加官方 nodejs.org 运行时，版本与 `release.yml` 打进发布包的一致，并对照该版本的 `SHASUMS256.txt` 校验。此外只装 `git`、`curl` 与 `ca-certificates`，供 Agent 执行命令之用。
- 容器以 root 启动，仅为接管数据目录顶层的属主，随即由 `setpriv` 降权到 `penguin`（uid/gid 1000）：宿主机上的 bind mount 无需事先准备，且除入口脚本外没有任何东西以特权运行。PID 1 是 `tini`，Agent 的 shell 命令留下的孤儿进程因此得以回收。
- `HEALTHCHECK` 打的是公开的 `GET /api/install`。
- 构建与发布步骤放在 `.github/workflows/docker.yml`。`release.yml` 在 `publish-npm` 之后按与 `mirror-oss` 相同的门槛调用它，且在构建前轮询 npm registry——发布步骤返回不等于该版本已可拉取。改动 `Dockerfile`、`docker/` 或该 workflow 的 pull request 会以同一个文件跑一次 amd64 冒烟构建：启动容器并检查就绪、登录、健康检查、进程用户、优雅停机，以及在同一数据目录上重启。
- `docker/compose.yaml` 是可直接复制运行的部署示例。新增的 [Docker 快速开始](https://penguin.ooo/docs/quickstart-docker)记录了从日志完成首次登录、以换 tag 的方式升级（容器内不支持自更新）、反向代理、Workspace 预览与忘记密码的救援路径；README 的安装小节与快速开始的路线表也在两种语言下补上了这条路线。
