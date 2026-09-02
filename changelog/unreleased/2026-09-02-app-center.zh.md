# 应用中心：会话里做出来的应用，在一个页面里登记、探测与控制

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `core`, `skills`, `docs`

[English](2026-09-02-app-center.md)

在对话里做出来的应用现在可以发布到应用中心——「智能体」之下的一个页面，列出每个已登记的应用及其实时状态，每行各带重启 / 停止按钮。每个应用绑定到做出它的那个 Session：`software-development` 插件新增的 `app-center` 技能让 Agent 把做好的应用以后台方式跑在固定端口、验证可访问后经新增的 `penguin app` CLI 登记；重启 / 停止按钮把请求发回该 Session，由 Agent 执行。

## 细节

- 服务端：Project 级的 `<project>/apps/<id>.toml` 登记表（文件是唯一真相源，API 是带校验的写入器；不落 SQLite），接口为 `GET|POST /api/projects/:p/apps`、`GET|PUT|DELETE …/apps/:id` 与 `POST …/apps/:id/actions`。状态探测应用的健康检查地址——任何 HTTP 响应即运行中，连接被拒或超时即已停止，无地址即未知——按地址缓存十秒，`?refresh=1` 重新探测。动作组成 `[app_center]` 来源块加说明正文，作为新 Task、排队的跟进消息或对运行中 Task 的 steering 送达所属 Session；Session 已删除则 409 `app_session_missing`。任意成员可读取与发送动作；登记、修改与取消登记仅 owner，同定时任务。
- Core：`[app_center]` 标记加入来源块（构造、解析与标题噪音清单）。
- CLI：`penguin app ls | register | unregister | status`。`register` 缺省把应用绑定到 `PENGUIN_SESSION_ID`，Agent 与 Workspace 由服务端按该 Session 填入，已存在的 `--id` 原地更新。
- 技能：`software-development` 的 `app-center`（清单版本 `2026-09-02.2`）——把应用以后台方式跑在固定端口、验证、带上地址与启动 / 停止命令登记、保持条目最新，并执行 `[app_center]` 请求。
- Web：应用中心页（`/apps`，导航与收起图标栏中位于智能体与插件库之间）：搜索框、状态分段、带类型图标 / 元信息行 / 状态胶囊的行、打开 / 重启 / 停止、含跳转到会话 / 编辑 / 取消注册的菜单、每 20 秒重新探测，以及组件包的分体式「新建应用」按钮——让 Project 默认 Agent 用构建应用的固定尾巴创建，或用手动表单登记到 Project 最近的某个会话。对话页把 `[app_center]` 块折叠成一行「应用中心：重启 …」提示，输入历史跳过这类消息。
- 文档：Web App、CLI、Server API 与 Skills 页面以双语描述了该页面、命令族与接口。
