# 从源码检出运行时也能使用机器管理

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`, `web`, `tooling`, `docs`
- **PR:** [#1023](https://github.com/Prism-Shadow/penguin-harness/pull/1023)

[English](2026-10-10-machines-dev-image.md)

从源码检出运行的服务端（`pnpm dev`、`pnpm desktop`）在每次安装或启用机器时，自行构建安装镜像。此前这样的服务端没有任何镜像：机器管理页禁用了「添加机器…」与「启用」，每次安装都返回 `409` `no_install_image`，提示语还说镜像会在「第一次热推后」获得，而热推从未带来镜像。

## 细节

- 镜像用与热推送相同的打包器构建。`scripts/deploy.mjs --out <file>` 打包的正是一次推送会发送的版本（web 产物、平台与 CLI 两个 bundle、node-pty、TypeScript、安装脚本、内置插件与插件库），把 gzip 压缩的升级请求体写入文件而不推送。这一用法不需要推送目标，也不需要凭据；web 产物构建在该文件旁边的独立目录里：`pnpm desktop` 与开发服务端正以 `packages/web/dist` 托管使用中的页面，因此镜像从不原地重建它。推送仍照旧原地构建。
- 服务端把请求体落成一份 hmr store，放在 `<root>/machines/checkout-image/<id>/hmr`，从不写进自己的 `<root>/hmr`；安装方式与热推送过的服务端相同：远端自行下载检出的 `VERSION` 所指的发布版，store 经 ssh 复制过去。镜像按内容命名；每次构建保留它所替换的那一份，以及仍有任务在安装的镜像，其余删除。
- 版本为 `<VERSION>+hmr.<平台 bundle 哈希>`，与热推送过的服务端报告的形式相同。未改动的工作区重建出同一份镜像，已装上它的机器不会被重装；平台代码改动之后，装着上一份镜像的机器显示为落后。
- 一批任务共用一次构建，构建进行中开始的任务直接加入它。服务端启动和页面列出机器时都不构建。构建超过 20 分钟即连同它启动的一切（pnpm、vite、插件安装）一并终止；服务端退出时仍在进行的构建同样如此：开发终端里按 Ctrl-C、开发服务端重启、桌面端退出。
- `GET /api/projects/:projectId/machines` 新增 `checkoutImage`（`unbuilt`、`building`、`built`，或 `failed` 并附构建输出的最后几行），只在源码检出时出现。`imageVersion` 报告检出最近一次构建的镜像，第一次构建之前仍为 `null`。
- 构建失败时，任务停在 `build the install image` 这一步，附构建输出的最后几行，不提供强制安装；机器管理页在提示区显示同样的内容，直到某次构建成功。
- 经机器更新通道的移交（安装时，以及服务端启动时的那轮同步）发送的是正在安装的那份计划的构建，因此源码检出移交的是它的镜像。
- 现在只有既不是安装版、也不是本仓库源码检出的服务端才会返回 `no_install_image`，其报错信息与页面提示都照此说明。作为依赖装进其他 pnpm 工作区的服务端不算源码检出，也从不运行那个工作区的 `scripts/deploy.mjs`。
- 推送或安装镜像记录的来源（`source.repo`，接收它的机器经 `GET /api/version` 与 harness 历史展示）所写的 origin 远端地址，不再带有 https 克隆可能携带的用户名与密码。
- `deploy.mjs` 在 Windows 上经 shell 调用 `pnpm`，因为那里的 `pnpm` 是一个 `.cmd` 包装脚本。
