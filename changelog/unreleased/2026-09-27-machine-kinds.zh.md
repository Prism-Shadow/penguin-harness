# 机器种类：ssh、WSL 与容器改为插件

- **Date:** 2026-09-27
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#855](https://github.com/Prism-Shadow/penguin-harness/pull/855)

[English](2026-09-27-machine-kinds.md)

机器现在分种类，每个种类是一个插件：`machine-ssh`（与以前一样，来自 `~/.ssh/config` 的机器）、`machine-wsl`（Windows 服务端上的每个 WSL 发行版）、`machine-docker`（一个已有容器，或按镜像创建的容器）。服务端本身只保留「一台机器一条连接」：会话、它的分帧与寿命、每台机器一条的队列。服务端不再按名字启动 ssh、wsl.exe 或容器命令行，也不再读 `~/.ssh/config`。

## Details

- 机器的 id 是 `<种类>:<名字>`：`ssh:<别名>` 与以前相同，另有 `wsl:<发行版>`、`docker:<名字>`。已有记录的 id 不变。
- `machine-ssh` 是常驻插件：无论 Project 是否列出，每个服务端都加载它（见 backward-compatibility 那一条）。`machine-wsl` 与 `machine-docker` 按 Project 在插件页启用，与 sandbox 后端相同。三者都在内置索引里，类别为 `machine`。
- 机器页按种类绘制各自的表单。选择器里的「+」为接受手工定义的种类新建机器：一段 ssh Host，或一个容器。卡片上的齿轮再次打开它；容器的定义还可以在那里移除，移除从不删除容器。WSL 卡片没有齿轮。
- 容器机器：定义指向一个已有容器，或一个镜像，外加原样逐项传给 argv 的运行参数（拒绝 `--rm`、`--name`、`-d`、`--detach`）与保活命令（默认 `sleep infinity`）。「连接」会启动已停的容器，按镜像定义的容器（`penguin-<名字>`，标签 `penguin.machine=<名字>`）不存在时会创建它。自动重连从不启动容器。命令行可以是 `docker`、`podman`、`nerdctl` 或一个绝对路径。
- WSL 机器：`wsl.exe --list --quiet` 列出的发行版，去掉 Docker Desktop 的与名字以 `penguin-` 开头的（WSL 沙盒后端自己的发行版）。只在 Linux 上对着桩 `wsl.exe` 验证过，还没有在真实 Windows 上跑过。
- 容器与 WSL 机器没有端口转发。它们在端口页上的转发显示为失败，并写明原因。
- 库里有记录、但种类没有加载的机器仍然列出，标为「种类不可用」。安装、连接、重启答 409 `machine_kind_unavailable`，自动重连跳过它，不计失败次数。
- API：`POST /api/projects/:projectId/machines/kinds/:kind/definitions`（`{ name, values }`），以及 `…/definitions/:name` 上的 `GET`、`PUT`（`{ values }`）、`DELETE`，取代已删除的 `…/machines/ssh-hosts` 与 `…/ssh-hosts/:alias`。机器列表带上 `kinds`，每台机器带上 `kind`（种类未加载时另有 `unavailable`）。
- 交接的机器会话改为 `machineSession.v3`。本构建第一次推送时，每条被持有的机器连接关闭并重新打开一次。
- 新表 `machine_definitions`（迁移 19，热推送期间安全）存放容器机器的定义。
