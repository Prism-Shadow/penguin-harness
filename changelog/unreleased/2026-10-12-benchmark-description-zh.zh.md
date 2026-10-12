# Benchmark：中文描述

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)

[English](2026-10-12-benchmark-description-zh.md)

`benchmark_config.toml` 新增可选的 `description_zh`，即中文描述，与插件 `package.json` 里的同名字段一样：服务端读写它（长度限制与 `description` 相同，2,000 个字符），Benchmark API 以 `descriptionZh` 返回，评估中心在中文界面下的卡片与 Benchmark 页面上用它代替 `description`，搜索两者都匹配。五个内置 Benchmark 与示例 Benchmark 都带上了中文描述，版本升至 `2026.10.12.1`；已有 Project 保留创建时写入的副本。不含该键的清单照旧读取，更早的版本会忽略它。
