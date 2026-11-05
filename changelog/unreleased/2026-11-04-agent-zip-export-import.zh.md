# Agent 导出为 zip，并可从 zip 导入

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `trace-index`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)
- **Breaking:** yes — 移除了 `GET …/agents/:agentId/export`、`POST …/agents/:agentId/import` 和 `POST …/agents` 的 `dataBase64` 字段

[English](2026-11-04-agent-zip-export-import.md)

Agent 现在以一个 zip 离开服务端，其中包含调用方选定的部分；也可以从这样的 zip 导入，成为新 Agent，或替换现有 Agent 的 State。原先的 `.tar.gz` 快照导出及其导入路由被取代。

## zip 格式

- 顶层只有一个以 Agent 命名的目录，其中包含与磁盘布局一致的 `agent_state/`、`manifest.json`（`format: "penguin-agent-zip/1"`，最后一个条目），以及选择了 Session 时的 `traces/<date>/<sessionId>_NNN.jsonl` 和 `traces/sessions.json`。
- 配置总会导出：`system_config.yaml`、`AGENTS.md` 和 `tools/`。Skill、钩子、记忆、工作台（可选是否含 `state.json`）和定时任务各自可选；定时任务默认不选。
- 字面写出的 MCP 凭据会被清空，并按位置记入 `manifest.redacted`：名字像凭据的 `env` 与 `headers` 值、`oauth` 中的密钥、URL 的密码与名字像凭据的查询参数，以及名字像凭据的 `args`（`--name=value` 与 `--name` 之后的参数，记为 `args:--name`，以及形如 URL 的参数中的同样位置）；不论其名，条目中任何字符串里 URL 的密码与连接串的 `Password=` 也会清空（`env:DATABASE_URL:password`、`<位置>:conn:Password`）。名字中有一个词是凭据词或以凭据词结尾才算（`GITHUB_TOKEN`、`apiKey`、`DB_PASS`、`SENTRY_DSN`、`PGPASSWORD`、`NGROK_AUTHTOKEN`），词只是以它开头或含有它不算（`max-tokens`、`keyword`、`keyboard`）。以 `${KEY}` 引用密钥保险柜的值原样导出，配置的其余内容同样原样导出；经 YAML 别名引用的凭据在其锚点处一并清空。密钥保险柜从不导出，只导出键名（`manifest.vaultKeys`）；Agent 密钥保险柜中的密钥类值（键名是凭据的或值形如令牌，纯数字的从不算）在 Trace 文件的 JSON 字符串内与 Session 标题中替换为 `[vault:<KEY>]`，计为 `traces:vault-values:<n>`；解析不了的行按纯文本替换，计为 `traces:unparsed-lines:<n>`。工作台的 `.build/`、`.harness/`、`.plugin.json` 和 `node_modules/`、任何 `.git` 路径、任意大小写的密钥保险柜文件、暂存残留、已过期的定时任务和链接（包括本身是链接的部件目录）都不会导出。
- Session 可选择不导出、最近活跃的 N 个（1–500）或按 Trace 日期目录选取的日期范围。每个 Session 整体导出，并带上同一 Agent 下的子 Agent Session 以及 sessions 表中的信息。含有超过 256 MiB 文件的 Session 不导出，并会列出。

## 路由

- `GET /api/projects/:p/agents/:a/archive?<parts>` 流式输出 zip（`<agentId>-<yyyymmdd>.zip`）；`GET …/archive/preview?<parts>` 报告它将包含的内容、条目数与说明。任何成员都可以调用。超出导入所能接受范围（50,000 个条目、未压缩 1 GiB、单个文件超过 256 MiB）的导出返回 413，预览会先说明原因。
- `POST /api/projects/:p/agents/import?agentId=&overwrite=1` 以原始 `application/octet-stream` 请求体接收 zip 或旧的 `.tar.gz` 包，返回 201，附带 Agent 卡片、导入了什么、跳过的 Session、需要补填的内容和说明（`{code, subject?, message}`）。id 已被占用时返回 409 `agent_exists`，并带 `details.agentId`；`overwrite=1` 仅限 Project owner。
- 上限：上传 100 MiB、50,000 个条目、单个条目 256 MiB、解压后共 1 GiB（413 `archive_too_large`）：在解压任何内容之前按中央目录声明的大小核对，且每个条目解压时都不超过其声明的大小。文件名、链接、忽略大小写后的重名（包括 Trace 文件）、Skill 的 `SKILL.md`、钩子包的 `hooks.json` 和工作台 id 都在改动任何 Agent 之前检查。manifest 标为 `false` 的部件不导入；manifest 所选部件不含 Session 时，Session 也不导入。
- 新 id 会先按模板创建 Agent，再换入归档中的 State。不含 `system_config.yaml` 的手写 zip 携带 `definition`（MCP Server、模型设置、内置工具名），按配置路由的校验应用到 Agent 自己配置的副本上，从不写入现行文件。
- 覆盖时先写入导入备份，保留 Agent 的身份、Session、密钥保险柜、API 密钥和雇佣关系；zip 未包含的部分、已过期的定时任务、zip 未携带数据时工作台的数据、手写 zip 时的 `tools/` 以及 State 中的其他内容都保留 Agent 自己的版本，被清空的凭据只在同一个 Server（名字与 command 相同且参数遮去凭据后相同，或名字与 URL 来源相同）且位置名字相同时从 Agent 自己的配置中补回，Agent 已缓存的运行时随之失效。Agent 自己的配置解析不了时仍可覆盖，不从中补回任何值并附说明；导出这样的 Agent 返回 422 `invalid_config`。
- 同一 Agent 的导入一次一个，从恢复到最后一个 Session；删除该 Agent 也排在同一队列里，导入写下的东西不会在 Agent 删除后残留。换入是在 Agent 下一个带标记的目录（`.import-<hex>/`，`.penguin-swap.json` 记其阶段）中完成的一系列改名。完成之前失败会把一切放回原处；放不回的留在带标记的目录中，什么也不删除，返回 500 `import_rollback_failed` 并点名该目录与备份，该 Agent 的下一次导入或服务端下一次启动会把它移回（服务端在换入中途停止后同样如此）；已提交换入的残余只删除，从不装回。换入之前的失败不改动 Agent，并删除创建了一半的新 Agent；换入之后，导入总是返回 201 与报告。
- 导入的 Session 保留其标题、时间、归档或保留标记、审批模式、思考等级和客户端；每个 Session 全有或全无地移入。字段不合法的记录、首个文件在 256 KiB 内的头部不是其 `session_meta`，或无法移入的 Session 以 `invalid` 跳过并附 `detail`；本安装已有的 Session id、或不分大小写的磁盘上该位置已有文件的 Session 以 `exists` 跳过，已有的 Trace 文件从不被替换。

## 兼容性

- 调用已移除路由的 API 客户端改用 `GET …/archive` 与 `POST …/agents/import?agentId=<id>&overwrite=1`；带 `dataBase64` 的 `POST …/agents` 改用 `POST …/agents/import`。版本冲突确认已取消：`overwrite=1` 即为确认。`penguin` CLI 从未调用被移除的路由，Web App 在同一版本中一并更新。
- 旧的 `.tar.gz` 包仍可导入，见[向后兼容](2026-11-04-backward-compatibility.zh.md)。
