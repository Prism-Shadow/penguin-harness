# 插件从按内容寻址的仓加载，每次激活一代

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `tooling`
- **PR:** [Myriad-Dreamin/penguin-harness#92](https://github.com/Myriad-Dreamin/penguin-harness/pull/92)
- **Breaking:** yes

[English](2026-09-29-plugin-store.md)

一台机器收到的每个服务端插件都按内容的 hash 存进 `<数据根>/plugin-store/`；进程加载插件只查一处：`<数据根>/plugins/current` 指向的那一代。插件索引条目带同一个 hash，现取的包入仓前先比对，Project 也可以钉住它运行的确切内容。仓与各代都会被清扫，不再随每次推送、安装和插件改动一直增长。

## 插件仓

- 插件仓、构建产出的树与索引仓库 penguin-plugins 用同一条路径规则排布条目。仓根下除 `.staging/` 外只有 `packages/`，一个条目在 `packages/[<@scope>/]<桶>/<名>/<版本>/<integrity 前 16 位十六进制>/`。桶取不带作用域的名字，与 crates.io 索引同一规则：1、2 个字符的名字落在 `1`、`2`，3 个字符的落在 `3/<首字符>`，更长的落在 `<第 1–2 个字符>/<第 3–4 个字符>`，例如 `@penguinharness/sandbox-bwrap` 在 `packages/@penguinharness/sa/nd/sandbox-bwrap/` 下。任何一层目录都不随插件数增长。一个条目内含 `manifest.toml`（索引清单，含 `integrity`）、`package/`（解开的包，依赖放在它自己的 `node_modules` 里）与空的完成标记 `.stored`，其 mtime 即入仓时间。索引仓的条目另带 `package-lock.json`，插件仓不写。
- `.stored` 最后写。没有它的条目视为不存在，同一内容下一次写入时替换它。
- `integrity` 为 `sha256-` 加 64 位十六进制，取包的确定性归档计算。归档器是 `scripts/plugin-entry.mjs`，与索引仓的算法逐行一致，因此索引条目写的哈希就是机器对现取包算出的那个。构建与仓都用这一个模块排布条目。同一内容只存一份；同名不同版本、同版本不同内容各占一个条目。
- 只有两个来源写仓：
  - **正在运行的构建**：每次激活时，构建插件 prefix（热推送的，否则安装目录旁的）的 `index.json` 列出的每个插件，仓里缺它的条目就入仓。失败只记日志，不会让启动失败。本机算出的 hash 与所列不同的包（例如在没有执行位的文件系统上）按它自己的 hash 入仓。
  - **registry**：在插件页安装时，由 npm 取到 `plugin-store/.staging/` 下的一个目录，打包、算 hash、入仓。npm 不再写 `<数据根>/plugins/`。

## 代

- `plugins/current` 是指针文件，指向一代 `plugins/<gen>/`。一代是一个 npm prefix：`package.json` 写 `dependencies`（名字 → 版本）与 `plugins`（名字 → `{ version, sha256 }`），`node_modules/<name>` 链接到仓条目的 `package/`。POSIX 上用 symlink，Windows 上用 junction，两者都建不了就复制。
- 代的键是它所含 (名字, sha256) 列表的 hash，同一组选择总是同一个目录。
- 写一代时先写在 `plugins/.tmp-<pid>/`，写完成标记，再改名到位；之后才翻转 `current`，方式是写临时文件再 rename。读的一方看到的要么是完整的旧一代，要么是完整的新一代。
- 数据根的 npm 前缀、热推送资产、安装目录旁的前缀和程序自身的依赖都不再是查找位置；热推送资产和安装目录旁的前缀只往仓里放。绝对路径（开发检出里的插件）仍按原路径导入。

## 激活

- 每次 App 启动都在导入之前先激活：首次启动、热推送，以及插件改动后的每次重新装配。重新装配走平台唯一的那条队列，两个管理员的改动不会交错。
- 一代由闭包解析而来，闭包是所有 Project 给本机的表的并集：
  - 钉住的名字（Project `[plugins]` 表里的 `name = { version = "…", integrity = "…" }`）只取那一个条目。格式不对的钉住会让该条目被丢弃。
  - 其余名字先取版本满足所有 Project 要求的仓条目，再取最高版本；同一版本内，当前构建列出的内容优先于 registry 现取。所以一次推送带来同名同版本的新内容时，下一次激活自然换到它。
- 表里点名、但仓里没有满足条件条目的名字，会在插件页上连同原因一起列出。
- App 在新的一代上启动失败时，`current` 翻回上一代；失败的那一代留在磁盘上。
- 链接进来的插件从仓条目运行。插件包自己解析不到 `@prismshadow/penguin-core` 时（插件 bundle 可以把它留作外部依赖，discord-bot 就是这样），改从正在运行的程序解析，经一个 `module.registerHooks` 的 resolve hook 实现。此前只有从安装目录旁加载的插件能找到程序的那一份，随热推送到达的找不到。

## 索引

- server 原来手写内嵌的索引（`builtin-index.json`）已删除。`scripts/build-plugins.mjs` 把它打出的每个包排成仓条目，并从这棵树重建 `index.json`、放进发布的 prefix，索引随构建走：在推送的 `plugins/` 里、在桌面构建里、在发行版安装里。从源码运行的 server 不带 prefix，不列内置条目。
- 条目的元数据取自包自己的 package.json。`plugins/` 下的代码插件声明 `author` 与顶层 `categories`，插件页按它分组。
- `GET /api/plugins/registry` 返回一个扁平的索引条目数组，按构建的索引、本机插件仓、发布的索引依次合并：每份内容一个条目，保留第一个来源的，yanked 的条目不列。响应不再带 `failures`：读不到的来源记入服务端日志，只让列表变短。
- 插件页一个名字一行，行上显示安装会取的那一个条目，与服务端安装的选行是同一个规则：web 现从 `@prismshadow/penguin-server/api` 引入 `pickIndexEntry`。插件的详情页列出这个名字下的全部内容：每一份的版本、integrity、是否在本机仓、当前这一代是否链接它，数据来自新增的 `GET /api/plugins/registry/contents?name=…`。
- 没有 integrity 的条目照列但不可安装，插件页上它那一行说明原因并禁用「安装」。某个来源无法访问时，插件页不再显示提示。

## 安装与移除

- 安装本机没有的包时，取该请求对应的索引条目——钉住的内容，或范围所允许的最高版本——按那个确切版本现取，入仓前比对 integrity。不一致返回 `400 plugin_integrity_mismatch` 并写明期望值与实际值，临时目录丢弃。没有任何来源列出的名称、或只以无 integrity 的条目列出的名称，返回 `400 plugin_not_installable`。
- `POST …/plugins/installed` 接受 `integrity` 并写入钉住。
- 移除插件不再跑 `npm uninstall`：下一代不包含它，它在仓里的条目保留到被清扫为止。

## 清扫

- 每次激活让 `plugins/current` 换了一代之后，以及服务端启动时，各清扫一次。保留的两代是现在的当前一代与激活前的当前一代。清扫尽力而为：失败只记日志，从不让启动失败。
- 清扫与激活在同一次启动里、指针写好之后运行，因此排在平台的装配队列上，永不在写一代的途中进行。清扫仓的部分还要排在仓的写入之后，registry 现取也在这条队列上。
- 仓里的条目满足任一条就保留，否则删除：
  - 被保留的某一代链接；
  - 被任何 Project 的表钉住，不论共享表还是任何一台机器的表；
  - 入仓不满一天。
- 没有 `.stored` 的条目是没写完的写入，与 `plugin-store/.staging/` 下的目录一样满一天删除。空的 `<版本>/`、`<名>/` 与桶目录随最后一个条目一起删除。
- 保留的两代之外的代都删除。
- 保留的某一代读不出来时，这一次清扫不删任何仓条目；旧的代与过期的暂存目录照删。
- 构建自带、但没有任何一代链接的包，与其他条目一样会被清扫。下一次激活会从随包的 prefix 重新入仓，Project 要它时它就在。

## 兼容性

旧版本从 registry 装进旧 npm 前缀 `<数据根>/plugins/node_modules/` 的插件不再加载，因为它们不在插件仓里。插件页会把它们显示为本机未安装，在插件页重新安装一次即取进仓里。旧前缀里的文件既不读取也不删除。随构建或热推送到达的插件不受影响，它们每次启动都会进仓。
