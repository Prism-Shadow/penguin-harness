# Benchmark 可从 zip 或经 Agent 导入，并可作为包导出

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `server`, `web`, `core`, `skills`, `docs`
- **PR:** [#1011](https://github.com/Prism-Shadow/penguin-harness/pull/1011)

[English](2026-10-09-benchmark-import-export.md)

评估中心新增**导入评估集**，Project 的任何成员都可使用；Benchmark 页面新增**导出**。两者搬运的都是 Benchmark 的[包](2026-10-09-benchmark-package.zh.md)——`benchmark.json` 与各个 `CASE-*` 文件夹——从不带分数。

## 导入

- 弹窗沿用技能页的两条路径。推荐路径把粘贴的来源（Prism-Shadow/penguin-harness-benchmark 等仓库里一个文件夹的链接、本地路径或一段描述）生成发给 Project 默认 Agent 的提示词，并作为新对话的草稿打开。提示词要求 Agent 把链接解析到 40 位提交号、只取那一个文件夹、写入前读完每个文件、以来源 `git` 和空记分板写入 `benchmarks/<id>/`，覆盖前先询问。服务端不抓取任何链接。
- 另一条路径把 zip 上传到 `POST /api/projects/:p/benchmarks/archive`，任何成员都可调用。服务端只接受 `benchmark.json` 与 `CASE-*` 目录，放在根目录或唯一一个以 id 命名的顶层目录里。zip-slip 路径、含控制字符或与另一条目只差大小写的名字、链接、`scoreboard.yaml`、`.jobs/` 与顶层其他条目、`status` 不是 `published`、缺少任一 README 的题目返回 400；超过 14MB、1000 个文件、单个文件 5MB 或解开后 20MB 的返回 413 `benchmark_too_large`，大小在解压任何内容之前读取。服务端原样写入各题，清单写入来源 `zip` 与导入时间，并写入 `evaluations: []`。
- id 已被占用时返回 409 `benchmark_exists`，以 `details.benchmarkId` 给出该 id。弹窗随即确认是否覆盖，写明会删除的评估记录与运行结果，再带上 `overwrite` 重新上传同一个 zip，整个目录随之替换。

## 导出

- `GET /api/projects/:p/benchmarks/:benchmarkId/archive` 任何成员都可调用，返回 `<id>-v<version>.zip`：磁盘上原样的 `benchmark.json` 与各题，不含记分板、`.jobs/`、点开头的条目与符号链接。`draft`、`failed` 与清单无法读取的 Benchmark 返回 409。
- 已发布 Benchmark 的页面在复制路径按钮旁显示导出图标，从页面所描述那份副本所在的服务端或机器下载。

## 细节

- agent-tuning `2026.10.09.4`：`benchmark-design` 新增 `reference/package.md`，定义包并说明如何从仓库文件夹导入，`SKILL.md` 以一行指向它。
- core 导出 `placeBenchmark`（预置所用的暂存写入），并增加替换同 id 已有 Benchmark 的模式。服务端的归档上限新增 `MAX_BENCHMARK_ARCHIVE_FILES`（1000），并从技能路由接过 zip-slip 检查与 14MB 上限。
- 服务端的错误体在 `code` 与 `message` 之外新增可选的 `details` 对象，承载客户端要据以行动的信息；Web App 的 `ApiError` 随之携带它。
- 文档的评估中心页与服务端 API 页说明了两者，画廊的模拟 API 也响应这两个路由。
