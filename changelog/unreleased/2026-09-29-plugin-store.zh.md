# 插件从按内容寻址的仓加载，每次激活一代

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `tooling`
- **PR:** [Myriad-Dreamin/penguin-harness#92](https://github.com/Myriad-Dreamin/penguin-harness/pull/92)
- **Breaking:** yes

[English](2026-09-29-plugin-store.md)

一台机器收到的每个服务端插件都按内容的 hash 存进 `<数据根>/plugin-store/`；进程加载插件只查一处：`<数据根>/plugins/current` 指向的那一代。插件索引条目带同一个 hash，现取的包入仓前先比对，Project 也可以钉住它运行的确切内容。仓与各代都会被清扫，不再随每次推送、安装和插件改动一直增长。

## 插件仓

- 仓与索引仓库 penguin-plugins 的 `plugins/` 子树同构。`<npm 名>/<版本>/<integrity 前 16 位十六进制>/` 一个条目，内含 `manifest.toml`（索引清单，含 `integrity`）、`package-lock.json`、`package/`（解开的包，依赖放在它自己的 `node_modules` 里）与 `.stored`（存入时间与来源）。
- `.stored` 最后写。没有它的条目视为不存在，同一内容下一次写入时替换它。
- `integrity` 为 `sha256-` 加 64 位十六进制，取包的确定性归档计算。归档器是 `scripts/plugin-entry.mjs`，与索引仓的算法逐行一致，因此索引条目写的哈希就是机器对现取包算出的那个。构建与仓都用这一个模块排布条目。同一内容只存一份；同名不同版本、同版本不同内容各占一个条目。
- 每次写入后由树重建 `plugin-store/index.json`：与索引同一形状的平铺数组。
- 只有三个来源写仓：
  - **热推送**：推送带来的每个内置插件在下一次启动时入仓。
  - **构建**：安装物在程序旁自带的插件在每次启动时逐条目校 hash、缺则复制，在后台进行。失败只记日志，不会让启动失败。
  - **registry**：在插件页安装时，由 npm 取到 `plugin-store/.staging/<pid>/`，打包、算 hash、入仓。npm 不再写 `<数据根>/plugins/`。

## 代

- `plugins/current` 是指针文件，指向一代 `plugins/<gen>/`。一代是一个 npm prefix：`package.json` 写 `dependencies`（名字 → 版本）与 `plugins`（名字 → `{ version, sha256 }`），`node_modules/<name>` 链接到仓条目的 `package/`。POSIX 上用 symlink，Windows 上用 junction，两者都建不了就复制。
- 代的键是它所含 (名字, sha256) 列表的 hash，同一组选择总是同一个目录。
- 写一代时先写在 `plugins/.tmp-<pid>/`，写完成标记，再改名到位；之后才翻转 `current`，方式是写临时文件再 rename，`plugins/previous` 记下它翻转前指向的那一代。读的一方看到的要么是完整的旧一代，要么是完整的新一代。
- 数据根的 npm 前缀、热推送资产、安装目录旁的前缀和程序自身的依赖都不再是查找位置；热推送资产和安装目录旁的前缀只往仓里放。绝对路径（开发检出里的插件）仍按原路径导入。

## 激活

- 每次 App 启动都在导入之前先激活：首次启动、热推送，以及插件改动后的每次重新装配。重新装配走平台唯一的那条队列，两个管理员的改动不会交错。
- 一代由闭包解析而来，闭包是所有 Project 给本机的表的并集：
  - 钉住的名字（Project `[plugins]` 表里的 `name = { version = "…", integrity = "…" }`）只取那一个条目。格式不对的钉住会让该条目被丢弃。
  - 其余名字先取版本满足所有 Project 要求的仓条目，再取最高版本；同一版本内，当前构建带来的内容（推送集或安装目录旁的前缀）优先于 registry 现取。所以一次推送带来同名同版本的新内容时，下一次激活自然换到它。
- 表里点名、但仓里没有满足条件条目的名字，会在插件页上连同原因一起列出。
- App 在新的一代上启动失败时，`current` 翻回上一代；失败的那一代留在磁盘上。
- 链接进来的插件从仓条目运行。插件包自己解析不到 `@prismshadow/penguin-core` 时（插件 bundle 可以把它留作外部依赖，discord-bot 就是这样），改从正在运行的程序解析，经一个 `module.registerHooks` 的 resolve hook 实现。此前只有从安装目录旁加载的插件能找到程序的那一份，随热推送到达的找不到。

## 索引与插件目录

- server 原来手写内嵌的索引（`builtin-index.json`）已删除。`scripts/build-plugins.mjs` 把它打出的每个包排成仓条目，并从这棵树重建 `index.json`、放进发布的 prefix，索引随构建走：在推送的 `plugins/` 里、在桌面构建里、在发行版安装里。从源码运行的 server 不带 prefix，不列内置条目。
- 条目的元数据取自包自己的 package.json。`plugins/` 下的代码插件声明 `author` 与顶层 `categories`，目录按它分组。
- `GET /api/plugins/registry` 把构建的索引、本机插件仓与发布的索引合成一张表。每行是一份内容，带 `sources`（`builtin`、`store`、`index`）与 `installable`。没有 integrity 的行照列但不可安装，yanked 的条目不列。
- 插件页给本机已有、已发布的行打标签；此处无法安装的行说明原因并禁用「安装」。

## 安装与移除

- 安装本机没有的包时，取该请求对应的目录行——钉住的内容，或范围所允许的最高版本——按那个确切版本现取，入仓前比对 integrity。不一致返回 `400 plugin_integrity_mismatch` 并写明期望值与实际值，临时目录丢弃。没有任何来源列出的名称、或只以无 integrity 的条目列出的名称，返回 `400 plugin_not_installable`。
- `POST …/plugins/installed` 接受 `integrity` 并写入钉住。
- 移除插件不再跑 `npm uninstall`：下一代不包含它，它在仓里的条目保留到被清扫为止。

## 清扫

- 每次激活让 `plugins/current` 换了一代之后，以及服务端启动时，各清扫一次。清扫尽力而为：失败只记日志，从不让启动失败。
- 清扫与激活在同一次启动里、指针写好之后运行，因此排在平台的装配队列上，永不在写一代的途中进行。清扫仓的部分还要排在仓的写入之后，registry 现取也在这条队列上。
- 仓里的条目满足任一条就保留，否则删除：
  - 被当前一代或上一代链接；
  - 被 harness 仍保留的热推送资产集（`hmr/store/assets/` 下当前那一份与回滚那一份）的激活清单列出。清单是构建写进插件 prefix 的 `index.json`；该文件出现之前的推送，取 prefix 的 `package.json`，其中列出的每个名字与版本的所有内容都保留。平台从未解开过的回滚资产集，从它的 `archives/plugins.tgz` 里读；
  - 被任何 Project 的表钉住，不论共享表还是任何一台机器的表；
  - 入仓不满一天。
- 没有 `.stored` 的条目是没写完的写入，满一天删除。空的 `<版本>/` 与 `<名>/` 目录随最后一个条目一起删除，`index.json` 随之重建。
- 除 `current` 与 `previous` 之外的代都删除；`plugin-store/.staging/` 下所属进程已不在运行的目录也删除。
- 要保留什么读不出来时（某一代、某个资产集的清单），这一次清扫不删任何仓条目；旧的代与失效的暂存目录照删。
- 构建自带、但没有任何一代链接的包，与其他条目一样会被清扫。下一次激活会从随包的 prefix 重新入仓，Project 要它时它就在。

## 兼容性

旧版本从 registry 装进旧 npm 前缀 `<数据根>/plugins/node_modules/` 的插件不再加载，因为它们不在插件仓里。插件页会把它们显示为本机未安装，在插件页重新安装一次即取进仓里。旧前缀里的文件既不读取也不删除。随构建或热推送到达的插件不受影响，它们每次启动都会进仓。
