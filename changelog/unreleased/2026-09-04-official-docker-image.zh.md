# 官方 Docker 镜像，由源码构建

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `ci`, `tooling`, `docs`
- **PR:** [#609](https://github.com/Prism-Shadow/penguin-harness/pull/609)

[English](2026-09-04-official-docker-image.md)

PenguinHarness 新增官方容器镜像 `hiyouga/penguinharness`（Docker Hub），由本仓库源码构建，提供 `linux/amd64` 与 `linux/arm64` 两个架构。每次 push `main` 都把该 commit 发布为 `latest`，并附一个不可变的孪生 tag `main-<sha7>`；发布版则推出 `X.Y.Z`、`X.Y`，以及在该 tag 仍是 GitHub 当前 latest Release 时的 `stable`。它在 `0.0.0.0:7364` 上运行 `penguin server`，数据目录落在 `/data` 卷上，因此一次部署就是一个容器加一个卷。compose 文件与文档中的每一条 `docker run` 都把端口发布在宿主机回环上（`127.0.0.1:7364:7364`），新部署因此只在运行 Docker 的那台机器上可达；对外开放是一个明确的选择，与反向代理一节并列记录。

## 细节

- 镜像走的是发布包 CLI 的同一套装配流程：安装 workspace，构建服务端所需的包，`pnpm deploy` 出一份生产依赖树到 `/opt/penguin/lib`，再把构建好的前端产物放到旁边的 `/opt/penguin/web`。分层按「在哪台机器上跑」切分——workspace 的构建固定在构建平台上，因为 TypeScript 与 Vite 的产物与平台无关；目标平台层只重新编译 `node-pty`，它是这棵依赖树里唯一的原生依赖，且不提供 Linux 预编译产物。运行层只把结果拷进来，从不安装编译器。镜像标签取自 `PENGUIN_VERSION` 与 `PENGUIN_COMMIT` 两个构建参数，commit 按发布流程同样的方式打进构建产物。
- 基础镜像为 Ubuntu 24.04 加官方 nodejs.org 运行时，版本与 `release.yml` 打进发布包的一致，并对照该版本的 `SHASUMS256.txt` 校验。此外只装 `git`、`curl` 与 `ca-certificates`，供 Agent 执行命令之用。
- 容器以 root 启动，仅为接管数据目录顶层的属主，随即由 `setpriv` 降权到 `penguin`（uid/gid 1000）：宿主机上的 bind mount 无需事先准备，且除入口脚本外没有任何东西以特权运行。PID 1 是 `tini`，Agent 的 shell 命令留下的孤儿进程因此得以回收。
- `HEALTHCHECK` 打的是公开的 `GET /api/install`。
- 构建与发布步骤放在 `.github/workflows/docker.yml`，两套 tag 策略都由它掌管：一条是 push `main`（不设路径过滤），另一条是 `release.yml` 的 `docker` job 经 `workflow_call` 调用，门槛与 `mirror-oss` 一致，并检出到该 tag。既然不再从 npm 安装任何东西，该 job 也不再等待 `publish-npm`。改动 `Dockerfile`、`docker/` 或该 workflow 的 pull request 会以同一个文件跑一次 amd64 冒烟构建，构建的正是该 pull request 自己的源码：启动容器并检查就绪、登录、健康检查、进程用户、优雅停机，以及在同一数据目录上重启。
- `docker/compose.yaml` 是可直接复制运行的部署示例。新增的 [Docker 快速开始](https://penguin.ooo/docs/quickstart-docker)记录了从日志完成首次登录、以换 tag 的方式升级（容器内不支持自更新）、反向代理、Workspace 预览与忘记密码的救援路径；README 的安装小节与快速开始的路线表也在两种语言下补上了这条路线。
