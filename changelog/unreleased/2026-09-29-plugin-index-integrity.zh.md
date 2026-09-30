# 插件索引的每一条都写明它的内容

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `tooling`

[English](2026-09-29-plugin-index-integrity.md)

插件索引条目现在带 `integrity`，即插件仓存放该包所用的键；插件目录的三个来源共用同一形状。现取的包入仓前与条目比对，Project 也可以钉住它运行的确切内容。

## Integrity

- `integrity` 为 `sha256-` 加 64 位十六进制，取包的确定性归档计算。归档器是 `scripts/plugin-entry.mjs`，与索引仓的算法逐行一致，因此索引条目写的哈希就是机器对现取包算出的那个。构建与插件仓都用这一个模块排布条目。
- 仓的键变一次：原来是 node-tar 输出的哈希，现在是这个归档器的。按旧键存的条目仍可读；随构建发布的包会在下次启动时按新键再存一份。

## 内置索引

- server 原来手写内嵌的索引（`builtin-index.json`）已删除。`scripts/build-plugins.mjs` 把它打出的每个包排成仓条目（`<名>/<版本>/<hash16>/manifest.toml + package-lock.json + package/`），并从这棵树重建 `index.json`、放进发布的 prefix，索引随构建走：在推送的 `plugins/` 里、在桌面构建里、在发行版安装里。
- 条目的元数据取自包自己的 package.json。`plugins/` 下的代码插件现在声明 `author` 与顶层 `categories`，目录按它分组。
- 从源码运行的 server 不带 prefix，不列内置条目。

## 现取与钉住

- 安装本机没有的包时，取该请求对应的目录行——钉住的内容，或范围所允许的最高版本——按那个确切版本现取，入仓前比对 integrity。不一致返回 `400 plugin_integrity_mismatch` 并写明期望值与实际值，临时目录丢弃。没有任何来源列出的名称、或只以无 integrity 的条目列出的名称，返回 `400 plugin_not_installable`。
- Project 的 `[plugins]` 表接受 `name = { version = "…", integrity = "…" }`。激活按钉住的条目取、不取其他；格式不对的钉住会让该条目被丢弃。只写版本范围的，激活现在取插件仓里满足范围的最高版本；同一版本内优先取运行中构建自带的那份内容。
- `POST …/plugins/installed` 接受 `integrity` 并写入钉住。

## 插件目录

- `GET /api/plugins/registry` 把构建的索引、本机插件仓与发布的索引合成一张表。每行是一份内容，带 `sources`（`builtin`、`store`、`index`）与 `installable`。没有 integrity 的行照列但不可安装，yanked 的条目不列。
- 插件页给本机已有、已发布的行打标签；此处无法安装的行说明原因并禁用「安装」。
