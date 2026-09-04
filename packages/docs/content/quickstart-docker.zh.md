---
title: Docker
description: 运行官方 PenguinHarness 镜像——一个容器、一个卷，7364 端口上是完整的 Web 应用。
---

官方镜像跑的就是 `penguin server` 启动的那个服务端，Web 应用在里面。整套部署只有一个容器和一个卷，因此它是把 PenguinHarness 装到自己电脑以外的机器上最短的一条路。

```
ghcr.io/prism-shadow/penguin-harness
```

tag 为 `X.Y.Z` 与 `X.Y`，当前发布版另有 `latest`。每个 tag 都是覆盖 `linux/amd64` 与 `linux/arm64` 的多平台 manifest，同一个引用在 x86 VPS 与 arm64 机器上通用。

## 跑起来

```yaml tab="compose.yaml"
services:
  penguin:
    image: ghcr.io/prism-shadow/penguin-harness:latest
    restart: unless-stopped
    ports:
      - "7364:7364"
    volumes:
      - penguin-data:/data
    stop_grace_period: 30s

volumes:
  penguin-data:
```

```bash tab="docker run"
docker volume create penguin-data
docker run -d --name penguin \
  -p 7364:7364 \
  -v penguin-data:/data \
  --restart unless-stopped \
  ghcr.io/prism-shadow/penguin-harness:latest
```

把 compose 文件放在当前目录，`docker compose up -d` 即启动。两种方式启动后，Web 应用都在 `http://<host>:7364`。

容器在自己的网络命名空间里监听 `0.0.0.0`，因此决定谁能访问它的是 `-p 7364:7364`。写成 `-p 127.0.0.1:7364:7364` 就只留在宿主机回环上，适合经 ssh 访问或放在反向代理之后的机器。

## 首次登录

新数据目录没有密码。在密码被设置之前，服务端每次启动都会以边框提示打印一条登录链接——从容器日志里读它：

```bash
docker compose logs penguin        # 或：docker logs penguin
```

```
+----------------------------------------------------------------------------------------------+
|   This server has no admin password yet. Open this link to claim it:                         |
|                                                                                              |
|     http://localhost:7364/api/auth/claim?token=GSiEDYM8MbsrqtMj7ofq7klUyXcfQNwt3oUriUHiBI8   |
|                                                                                              |
|   The link lasts 30 days or until a password is set; restarting prints a fresh one.          |
+----------------------------------------------------------------------------------------------+
```

那条 URL 里的 `localhost` 是服务端对自己的称呼；把它换成你实际访问容器所用的主机名或 IP，保留整段 `?token=...` 再打开即可。落地即已登录为 `admin`，随即设置密码。链接在每次启动时重新铸造，所以一次重启就会作废你正看着的那条，并打印一条新的。

如果从日志里读链接不适合你的场景，也可以直接把密码钉死——但必须**在首次启动之前**：

```yaml
environment:
  PENGUIN_SEED_ADMIN_PASSWORD: "choose-something-long"
```

它以该密码（至少 8 位）种下内置管理员 `admin`，并不再打印提示。它**仅在尚无任何用户时生效**，也就是空数据目录的第一次启动：加到已被认领的数据目录上不会有任何效果，事后改动同样无效。

## 配置模型

PenguinHarness 不内置任何模型凭据。可以用 Web 应用的**模型**页，也可以用容器里的 CLI：

```bash
docker compose exec -u penguin penguin \
  penguin config model add --provider deepseek --model-id deepseek-v4-flash-vision-exp --api-key sk-... --set-default
```

`-u penguin` 是必要的：`docker exec` 默认以 root 执行，它写进 `/data` 的文件会归 root 所有，而服务端是以 uid 1000 运行的。内置分组见[模型与 Provider](/models)。

## 镜像里有什么

| | |
| --- | --- |
| 基础镜像 | Ubuntu 24.04，加官方 Node.js 运行时，版本与发布包内嵌的一致 |
| 启动命令 | `penguin server`，监听 `0.0.0.0:7364` |
| 数据目录 | `/data`，声明为卷——模型配置、会话、Trace 与 SQLite 数据库都在其中 |
| 运行用户 | `penguin`，uid/gid 1000；入口脚本仅为接管数据目录的属主而以 root 启动，随即降权 |
| 健康检查 | 每 30 秒一次 `GET /api/install` |
| 工具 | `git`、`curl` 与 Ubuntu 标准用户态，供 Agent 执行命令 |

Agent 的 `exec_command` 跑的一切都发生在**这个容器内部**，用的是它的文件系统与它的网络。这既是隔离边界，也是能力边界：容器能访问什么，Agent 就能访问什么，仅此而已。要给它一个 Workspace 就挂一个目录进来（`-v /srv/project:/srv/project`），注意该挂载需要对 uid 1000 可写。

镜像不带编译器，Node 之外也不带其他语言运行时。临时用一下，在容器里 `apt-get install` 是可行的，但下一次 `docker pull` 就没了；凡是要长期依赖的，构建一个派生镜像：

```dockerfile
FROM ghcr.io/prism-shadow/penguin-harness:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*
USER penguin
```

注意运行镜像刻意不含 C/C++ 工具链：那是构建阶段用完即丢的一层。

## 环境变量

完整清单见[配置参考](/configuration)，这里只列容器部署会用到的。

| 变量 | 在本镜像中 |
| --- | --- |
| `PENGUIN_HOME` | `/data`——除非同时改卷的挂载点，否则不要改 |
| `HOST` | `0.0.0.0`——容器自己的命名空间，对外由 `-p` 决定 |
| `PORT` | `7364`；改它会连带把健康检查一起移过去 |
| `PENGUIN_SEED_ADMIN_PASSWORD` | 钉死初始管理员密码，仅首次启动生效（见上文） |
| `PENGUIN_TRUST_PROXY` | 在终结 TLS 的反向代理之后设为 `1`，使会话 Cookie 带上 `Secure` |
| `PENGUIN_PREVIEW_ORIGIN` | 指向同一容器的第二个主机名，用于 Workspace 的 HTML 预览 |
| `PENGUIN_UPDATE_CHECK` | `off` 关闭新版本检查——服务端唯一一个非模型的出网请求 |

### 反向代理之后

把容器发布在回环上，在它前面终结 TLS，并设 `PENGUIN_TRUST_PROXY=1`。代理必须自己设置或剥除 `x-forwarded-proto`；该头由调用方提供，这正是服务端在你明说之前不予采信的原因。HTTPS 部署下不设它，签发的会话 Cookie 就不带 `Secure` 标记。

### Workspace 预览

Task 产出的 HTML，在有独立来源时会从另一个来源提供。非回环绑定下没有可推导的回环对应地址，预览会退化为同源沙箱，此时 Cookie、`localStorage` 与第三方内嵌都不可用。把 `PENGUIN_PREVIEW_ORIGIN` 指向路由到同一容器的第二个主机名即可恢复隔离版本——它必须在**主机名**上不同，仅端口不同不算。

## 升级

拉一个新 tag 并重建容器。数据目录在卷上，原样保留：

```bash
docker compose pull && docker compose up -d
```

容器内的自更新**不是**升级路径。Web 应用的升级按钮在这里会报「不支持」——服务端没有可再次运行的 CLI 入口，无从把升级交出去——重启入口也会报没有托管进程。在容器里执行 `penguin update` 则会把新包装进下次重建即丢弃的文件系统，而且无论如何都会失败：运行镜像不含编译器，`node-pty` 也没有可回退的 Linux 预编译产物。

停止是优雅的：`SIGTERM` 会打断运行中的 Task，等它们收尾，再关闭数据库。空闲的服务端远不到一秒就停住，繁忙的可能要几秒——compose 示例把 Docker 默认的 10 秒宽限期调高，正是为此。

## 救援：忘记管理员密码

授权模型就是数据目录本身——能执行这条命令的人本就持有那个数据库。必须先停掉服务端，因为一个数据目录同一时刻只有一个写者：

```bash
docker compose stop penguin
docker compose run --rm penguin penguin server reset-admin-password
docker compose start penguin
```

账号回到未认领状态并清空全部会话，之后照新服务器的流程，从日志里的首次登录链接重新登录。

## 下一步

- [Web 应用指南](/web-app)：在浏览器里使用 PenguinHarness。
- [安全模型](/security)：谁能做什么，凭什么。
- [配置参考](/configuration)：全部环境变量与配置字段。
