# Session 绑定飞书机器人

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)

[English](2026-08-25-feishu-session-bridge.md)

新增消息渠道绑定，飞书（Lark）为首个渠道：在 Web 侧栏选中一个 Session 绑定到自建飞书应用后，发给机器人的消息以普通用户输入进入该 Session，AI 完成的回复再转发回飞书会话。

## 细节

- Session 行新增「绑定到飞书…」操作，对话框包含 App ID / App Secret / API 域名、教程链接、凭据测试、「发送测试消息」探测与带确认的解绑。存在的绑定即处于活动状态——主按钮为「保存并连接」，停止连接的方式是解绑。已保存的 Secret 只以全站统一掩码作为占位符展示（输入即替换、留空即保留）；已绑定的行显示一枚小纸飞机标识。
- 侧栏会话行的悬停按钮改形：归档保留为直接按钮，删除按钮换成省略号「更多」按钮——点击即在按钮处打开该行的完整右键菜单（菜单新增了仅靠右键难以发现的配置类操作），删除移入菜单（仍为危险样式）。
- 左侧导航新增「消息软件」页（`/messaging`，位于成本中心与评估中心之间）：列出当前 Project 的全部绑定——会话（可点击打开）、Agent、渠道、实时运行状态——编辑复用同一个绑定对话框，解绑带确认；空态指向会话行菜单入口。
- 服务端以带渠道判别列的 `messaging_bindings` 表存储绑定（一个 Session 一个绑定，同一渠道下一个机器人账号一个绑定——409 `feishu_app_in_use`），并经渠道连接器接缝运行消息桥——每个绑定一条长连接事件流，飞书连接器为首个实现。入站文本以 `queueIfBusy` 发起 Task（忙碌排队、绝不 409）；其他消息类型收到双语「仅支持文本」回复；每个完成的任务把助手文本镜像回最近的会话（群聊回复到原消息），按飞书文本消息大小上限分段；有工具调用等待审批时发送一行指向 Web 界面的提醒。
- `/api/sessions/:sessionId/messaging/feishu` 下新增接口（get / put / delete / test / test-message），另有 `GET /api/projects/:projectId/messaging` 为页面提供不含密钥的列表：Secret 在所有响应中掩码、留空重存时保持原值，读取对任意 Project 成员开放、写入仅限所有者。删除 Session 连带删除其绑定。
