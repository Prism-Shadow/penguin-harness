# 插件是按 npm integrity 核对的 tarball，在到达的地方加载，并到达每一条渠道

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `core`, `cli`, `docker`, `release`
- **PR:** [#945](https://github.com/Prism-Shadow/penguin-harness/pull/945)
- **Breaking:** yes

[English](2026-09-29-plugin-distribution.md)

插件自己打包自己：它的 npm tarball 就是它的全部，声明的依赖不被安装。一个插件由名字、版本与 npm 自己的 `dist.integrity` 认定。它留在到达的地方，以解压好的包放在某个 prefix 的 `node_modules/<名>/` 下，旁边的 `.integrity` 记着那个 integrity：构建的随包插件目录，或下载用的 `<数据根>/plugins/`。每一份构建都以同一种方式带着插件，Docker 镜像与源码检出也是。随包下发的插件仍要等某个 Project 要求时才加载。

## 构建与索引

- `builtin-index.json` 去掉。`build-plugins` 用 `pnpm pack` 把每个插件打包一次，记下 tarball 的 integrity，再解压进构建的随包插件目录 `plugins/{index.json, node_modules/<名>/}`；发版上传的就是这几份 tarball（`--tarballs`）。
- `GET /api/plugins/registry` 按公开索引、构建索引、已下载插件的顺序合并，每份内容（名称、版本、integrity）一行；被撤下（yanked）的不列。

## 加载与下载

- 每次 App 启动前，各 Project 要求的名字在本机已有的包之间挑选：钉住的只取那一份；否则取满足要求的最高版本，同一版本里构建自带的那一份优先。
- 安装本机没有的插件时，用 `npm pack` 下载索引那一行的确切版本：用的是 `PATH` 上的 npm，其后补上运行中 Node 所在的目录，Windows 上经 cmd.exe 调用 `npm.cmd`。下载后对 tarball 算 sha512，与该行的 integrity 比对，不一致返回 `400 plugin_integrity_mismatch`。一致的 tarball 先解压到 `<数据根>/plugins/.staging/`，再改名放进 `node_modules/<名>/`，之后才删除被替换的旧版本。
- 在这两次改名之间崩溃的，下次启动时不联网即可恢复：被移开的旧包会被放回。
- 运行中的构建没有、但 hmr 仍保留的某次推送里有的插件，在那次推送被清理之前复制到 `<数据根>/plugins/`。
- `POST …/plugins/installed` 接受 `integrity` 并写入钉住。移除插件只改插件表。

## 渠道

- **Docker 镜像：**在 `/opt/penguin/lib/plugins` 带随包插件目录，服务端在入口的真实路径旁找到它。Docker 快速上手新增一节「在容器里运行沙盒」。
- **npm 全局安装：**`@prismshadow/penguin-cli` 只带 `plugins/index.json`；启用其中列出的插件时从 registry 下载。
- **源码检出：**`pnpm build` 与 dev 预构建把随包插件目录写到 `packages/cli/plugins/` 与 `packages/server/plugins/`。Project 的插件表不再以绝对路径加载插件。
- `@penguinharness/sandbox-dsh` 声明了运行时依赖，在它把依赖打进自己的包之前加载不起来。

## 兼容性

- 插件表里以绝对路径点名插件的条目不再加载。插件页会写明原因；这类插件应改为从开发构建的随包插件目录获得。
- 更早的构建用 `npm install` 装进 `<数据根>/plugins/node_modules/` 的包仍按版本加载。它们没有记下 integrity，所以钉住选不到它们。npm 装在它们旁边的依赖留在原处，不再被维护。
