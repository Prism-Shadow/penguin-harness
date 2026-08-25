# Session 绑定飞书机器人

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)

[English](2026-08-25-feishu-session-bridge.md)

新增 Session 与飞书（Lark）机器人的绑定：在 Web 侧栏选中一个 Session 绑定到自建飞书应用后，发给机器人的消息会作为输入进入该 Session，AI 完成的回复再转发回飞书会话。

## 细节

- Session 行新增「绑定到飞书…」操作，打开的对话框包含 App ID / App Secret / API 域名与启用开关，另有凭据测试、「发送测试消息」探测，以及带确认的解绑；已绑定的行显示一个小纸飞机标识。
- 服务端为每个启用的绑定维持一条飞书长连接事件流（无需公网回调地址），随调度器一起启动、随 App 一起停止。入站文本消息以 `[feishu_message]` 前缀的服务端输入在绑定 Session 上发起 Task——忙碌的 Session 排入 follow-up 队列——其他消息类型收到双语的「仅支持文本」回复。每个完成的任务把助手文本镜像回最近的会话（群聊回复到原消息），按飞书文本消息大小上限分段；有工具调用等待审批时会发送一行指向 Web 界面的提醒。
- `/api/sessions/:sessionId/feishu` 下新增接口（get / put / delete / test / test-message）：一个 Session 一个绑定、一个飞书应用一个绑定（409 `feishu_app_in_use`），Secret 在所有响应中掩码、留空重存时保持原值，读取对任意 Project 成员开放、写入仅限所有者。删除 Session 连带删除其绑定。
- core 新增 `[feishu_message]` 来源块（builder 与 parser，位于 `[scheduled_task]` 旁），对话页将其折叠为一行「来自飞书的消息」横幅。
