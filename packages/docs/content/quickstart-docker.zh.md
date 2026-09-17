---
title: Docker
description: 运行官方 PenguinHarness 镜像，一个容器加一个数据卷，就在 7364 端口提供完整的 Web App。
---

官方镜像运行的就是 `penguin server` 启动的那个服务端，Web App 也在其中。整套部署只有一个容器和一个数据卷，所以要把 PenguinHarness 装到自己电脑以外的机器上，Docker 是最短的一条路。

## 开始之前

- 在要运行 PenguinHarness 的机器上装好 Docker。下面的示例同时给出 Docker Compose 和 `docker run` 两种写法。
- 一个模型供应商的 API Key。

## 启动容器

在下面两个标签页中任选一种：保存 compose 文件，或者直接执行命令。

```yaml tab="compose.yaml"
services:
  penguin:
    image: hiyouga/penguinharness:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:7364:7364"
    volumes:
      - penguin-data:/data
    stop_grace_period: 30s

volumes:
  penguin-data:
```

```bash tab="docker run"
docker volume create penguin-data
docker run -d --name penguin \
  -p 127.0.0.1:7364:7364 \
  -v penguin-data:/data \
  --restart unless-stopped \
  hiyouga/penguinharness:latest
```

把 compose 文件保存在当前目录后，执行 `docker compose up -d` 启动。无论用哪种方式，启动后都能在运行 Docker 的那台机器上通过 `http://localhost:7364` 打开 Web App。

### 从其他机器访问

两个示例都把端口发布在运行 Docker 那台机器的回环接口上，所以新部署的服务从别处访问不到。要在另一台机器上使用，可以用 ssh 转发端口：`ssh -L 7364:127.0.0.1:7364 <host>`。

对外开放需要你主动去做：改为把端口发布到所有网络接口，`docker run` 用 `-p 7364:7364` 或 `-p 0.0.0.0:7364:7364`，compose 里写 `"7364:7364"`。最好再放到一个终结 TLS 的反向代理之后，见[在反向代理后运行](#在反向代理后运行)。

在容器自己的网络命名空间里，服务始终监听 `0.0.0.0`，端口发布正是靠这一点才能生效。`-p` 里的地址决定的是宿主机这一侧。

## 首次登录

新的数据目录还没有密码。在设置密码之前，服务端每次启动都会以带边框的提示打印一条登录链接。从容器日志里找到它：

```bash
docker compose logs penguin        # or: docker logs penguin
```

提示如下：

```
+----------------------------------------------------------------------------------------------+
|   This server has no admin password yet. Open this link to claim it:                         |
|                                                                                              |
|     http://localhost:7364/api/auth/claim?token=GSiEDYM8MbsrqtMj7ofq7klUyXcfQNwt3oUriUHiBI8   |
|                                                                                              |
|   The link lasts 30 days or until a password is set; restarting prints a fresh one.          |
+----------------------------------------------------------------------------------------------+
```

链接里的 `localhost` 是服务端对自己的称呼。按上面的方式发布在回环接口上时，它对你来说也是同一台机器，所以在运行 Docker 的机器上原样打开链接即可。如果已经把容器发布到网络上，就把 `localhost` 换成你访问它时用的主机名。两种情况下都要保留完整的 `?token=...`。

打开链接即以 `admin` 身份登录，然后设置密码。每次启动都会重新生成链接，所以重启之后，你手上那条链接就失效了，日志里会打印一条新的。

### 提前设置密码

如果不方便从日志里读取链接，可以直接固定密码，但要在首次启动之前设置：

```yaml
environment:
  PENGUIN_SEED_ADMIN_PASSWORD: "choose-something-long"
```

服务端会用这个密码（至少 8 个字符）创建内置的 `admin` 账号，并且不再打印登录提示。这个变量只在还没有任何用户时生效，也就是空数据目录第一次启动的时候。给已经认领过的数据目录加上它不会有任何效果，事后修改同样无效。

## 配置模型

PenguinHarness 不内置任何模型凭据。可以在 Web App 的**模型库**页面添加模型，也可以在容器里用 CLI 添加：

```bash
docker compose exec -u penguin penguin \
  penguin config model add --provider deepseek --model-id deepseek-flash --api-key sk-... --set-default
```

命令中的 `-u penguin` 不能省略。`docker exec` 默认以 root 身份执行，写进 `/data` 的文件会归 root 所有，而服务端是以 uid 1000 运行的。

内置分组见[模型与 Provider](/models)。

## 跑通第一个 Task

在 Web App 的侧边栏点击**新建对话**，然后发送第一条消息，例如「创建 hello.txt，内容为 Hello, Penguin」。Agent 执行的命令都在容器内运行；怎样把宿主机上的目录交给 Agent，见 [Agent 能访问什么](#agent-能访问什么)。对话页面的完整说明见[对话](/chat)。

## 选择镜像 tag

镜像名为：

```
hiyouga/penguinharness
```

tag 分为两类：

- `latest` 跟随 `main` 分支，每次推送都会重新构建。
- `X.Y.Z` 是正式发布版，用这个 tag 自身的源码构建。

没有 `main-<sha>`、`X.Y` 或 `stable` 这类 tag，因此不存在换个名字跟着变动的别名。每个 tag 都是覆盖 `linux/amd64` 与 `linux/arm64` 的多平台 manifest，同一个引用在 x86 VPS 和 arm64 VPS 上都能用。本页示例使用 `latest`；如果希望部署只在发布新版本时才更新，就固定到具体版本号。

## 镜像里有什么

| 项目 | 说明 |
| --- | --- |
| 基础镜像 | Ubuntu 24.04，加上官方 Node.js 运行时，版本与发布包内置的一致 |
| 启动命令 | `penguin server`，监听 `0.0.0.0:7364` |
| 数据目录 | `/data`，声明为数据卷，存放模型配置、Session、Trace 和 SQLite 数据库 |
| 运行用户 | `penguin`，uid/gid 1000。入口脚本以 root 启动，只为接管数据目录的所有权，随后降权为 `penguin` 用户 |
| 健康检查 | 每 30 秒请求一次 `GET /api/install` |
| 工具 | `git`、`curl` 与 Ubuntu 标准用户态工具，供 Agent 执行命令 |

### Agent 能访问什么

Agent 通过 `exec_command` 执行的一切都发生在这个容器里，用的是容器的文件系统和网络。这是隔离边界，也是能力的上限：容器能访问到的，Agent 都能访问到，除此之外一概访问不到。

要给 Agent 一个 Workspace，就挂载一个目录，例如 `-v /srv/project:/srv/project`。挂载的目录必须允许 uid 1000 写入。

### 给镜像添加工具

镜像里没有编译器，除 Node 之外也没有其他语言运行时。在容器里执行 `apt-get install` 可以应付一次性的需要，但下一次 `docker pull` 之后装过的包就没了。长期依赖的工具，请构建一个派生镜像：

```dockerfile
FROM hiyouga/penguinharness:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*
USER penguin
```

运行时镜像刻意不带 C/C++ 工具链：工具链只存在于构建阶段，构建完就丢弃了。

## 环境变量

下表列出容器部署会用到的变量，完整列表见[配置参考](/configuration)。

| 变量 | 在本镜像中 |
| --- | --- |
| `PENGUIN_HOME` | `/data`。除非同时移动数据卷，否则不要修改 |
| `HOST` | `0.0.0.0`，作用于容器自己的网络命名空间。宿主机一侧由 `-p` 决定，示例都保持在回环接口上 |
| `PORT` | `7364`。修改后，健康检查会随之改用新端口 |
| `PENGUIN_SEED_ADMIN_PASSWORD` | 固定初始管理员密码，仅在首次启动时生效，见[提前设置密码](#提前设置密码) |
| `PENGUIN_TRUST_PROXY` | 放在终结 TLS 的反向代理之后时设为 `1`，会话 Cookie 才会带上 `Secure` 标记 |
| `PENGUIN_PREVIEW_ORIGIN` | 路由到同一容器的第二个主机名，用于 Workspace 中的 HTML 预览 |
| `PENGUIN_UPDATE_CHECK` | 设为 `off` 关闭自动的版本检查。模型请求、远程控制连接、Key 授权和代理测试照常出站 |

### 在反向代理后运行

把容器发布在回环接口上，在它前面终结 TLS，并设置 `PENGUIN_TRUST_PROXY=1`。反向代理必须自己设置或清除 `x-forwarded-proto`：这个请求头由调用方提供，服务端正因如此，在你明确开启之前一直不采信它。HTTPS 部署如果不设置 `PENGUIN_TRUST_PROXY`，签发的会话 Cookie 就不带 `Secure` 标记。

### 提供 Workspace 预览

Task 生成的 HTML 在有独立来源时，会从独立的来源提供预览。绑定在非回环地址上时，推导不出对应的回环地址，预览会退回同源沙箱，这时 Cookie、`localStorage` 和第三方嵌入内容都不能用。要恢复隔离的预览，把 `PENGUIN_PREVIEW_ORIGIN` 指向路由到同一容器的第二个主机名。它必须在主机名上有所不同，只换端口不行。

## 升级容器

拉取更新的 tag，然后重建容器。数据目录在数据卷上，会原样保留：

```bash
docker compose pull && docker compose up -d
```

> [!WARNING]
> 不要在容器内更新。更新弹窗会提示当前安装无法自行更新，而 `penguin update` 在容器里装下的任何东西，都会在下次重建容器时丢失。

服务端会平稳停止：收到 `SIGTERM` 后，它先中断正在运行的 Task，等它们收尾，再关闭数据库。空闲时不到一秒就能停下，繁忙时可能要几秒，所以 compose 示例调大了 Docker 默认 10 秒的宽限期。

## 重置忘记的管理员密码

先停止服务端，因为一个数据目录同一时刻只能有一个写入者。然后重置密码，再重新启动：

```bash
docker compose stop penguin
docker compose run --rm penguin penguin server reset-admin-password
docker compose start penguin
```

重置不需要其他授权：数据目录本身就是授权，能执行这条命令的人本来就拥有这个数据库。`admin` 账号会回到未认领状态，已有的登录会话全部失效。之后按照[首次登录](#首次登录)的做法，用日志里的首次登录链接重新登录。

## 下一步

- [Web App](/web-app)：在浏览器里使用 PenguinHarness。
- [更新 PenguinHarness](/updates)：查看版本并升级。
- [安全模型](/security)：谁能做什么，凭的是什么。
- [配置参考](/configuration)：全部环境变量与配置字段。
