# 向后兼容：没有版本的 `server.lock`

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `core`, `server`
- **PR:** [#1056](https://github.com/Prism-Shadow/penguin-harness/pull/1056)

[English](2026-10-12-backward-compatibility.md)

[数据根目录由较早的服务器持有时，Project 配置的一次性迁移不写回文件](2026-10-12-dev-cli-data-root.zh.md)，服务器为此开始在 `<root>/server.lock` 中记录自己的版本。此前的服务器写下的锁只有 `pid`、`port` 与 `startedAt`，因此已安装的版本可能以这样的锁持有某个数据根目录，而更新的代码同时在读取这个目录。

## 旧形态：没有 `version` 的锁

存活的、没有 `version` 的锁视为比任何版本都早的服务器。它持有数据根目录期间，该目录下 `.project_config.toml` 的迁移只在内存中使用，文件不被改写。锁的读取方保持宽松：没有该字段的锁对 CLI 的附着、桌面壳的附着模式与服务器的单实例检查仍然有效。已失效的锁（进程或端口已不在）不会阻止写回。

## 用户需要做什么

无需任何操作。较早的服务器升级或停止之后，下一次读取即写回迁移后的文件。

## 何时可以移除

在 0.3.0 发布准备时，由负责发布准备的人与 `migrateLegacyClientTypes` 一起移除（见[向后兼容](2026-10-01-backward-compatibility.zh.md)），前提是不再可能有早于版本字段的服务器在任何数据根目录上运行。移除的内容：

- `packages/core/src/state/migration-write-back.ts` 中 `predates` 把没有版本的锁视为更早的分支；
- `packages/core/test/migration-write-back.test.ts` 中「counts a live server whose lock records no version as older」用例。

写回规则本身在不再有一次性迁移调用它时移除。
