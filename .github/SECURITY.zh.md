# 安全策略

[English](SECURITY.md)

## 支持的版本

PenguinHarness 尚未发布 1.0，代码从 `main` 出货。项目没有维护分支，也不做回移植：修复进入下一个版本，
拿到修复的方式就是升级。

| 版本           | 是否支持 |
| -------------- | -------- |
| 最新发布版本   | 是       |
| 更早的任何版本 | 否       |

历次发布见 [CHANGELOG.zh.md](../CHANGELOG.zh.md)；`penguin version` 会打印某台机器实际运行的是哪个
构建。

## 报告漏洞

请通过 GitHub 的
["Report a vulnerability"](https://github.com/Prism-Shadow/penguin-harness/security/advisories/new)
表单私下报告。它会创建一份只有维护者可见的 advisory 草稿，讨论、修复与最终披露都挂在同一处。

如果你无法使用该表单，请发邮件至 <hiyouga@buaa.edu.cn>。不要为安全问题开公开 issue、discussion 或
Pull Request，也不要发到 Discord 或微信群——那些都是公开场合。

一份报告最有用的内容是：受影响的版本、PenguinHarness 的安装方式（桌面应用、CLI，还是自行运行的
server）、操作系统，以及能复现问题的最短步骤。**发送前请先剔除凭据。** 数据根目录中的 Provider API
Key、消息机器人 Token 与 Vault 条目都以可读形式存放，因此 `system_config.yaml`、`.env`、Trace 或完整
日志极有可能夹带密钥；请只摘录真正相关的那几行，而不要整份附上。

你会先收到一封确认回执；待有人看过之后，会收到关于影响范围与后续处理的判断。这是一个小团队，时间尺度
以天计而非以小时计，并且很可能会追问更多细节。

## 什么算漏洞

PenguinHarness 在你自己的机器上运行 Agent，而这个 Agent 会执行 shell 命令、读写文件，并带着你配置的
凭据访问模型 Provider。在这一设计之内，以下属于范围内：

- 任何使 Session 越过当前审批模式所划定边界的行为——绕过或伪造审批提示，或以本应被匹配到的写法规避
  `[command_policy]` 的 deny 规则。
- 凭据泄露：API Key、机器人 Token 或 Vault 条目出现在日志、Trace、错误页、LLM 请求，或另一名用户的
  视图中。
- 任何越过 server 多用户边界的行为——某个账号触及另一账号的 Project、Session、Workspace 或用量数据，
  认证与会话 Token 处理可被攻破，或某个 API 路由缺少鉴权。
- 能够动手的远端输入：网页、文件、MCP Server 或入站聊天消息中的内容，以用户无法预见的方式被当作指令
  执行，或根本没有经过审批边界就抵达了工具。
- 安装器与更新路径：安装过程或 `penguin update` 可被引导去获取并非本项目发布的代码。

以下不属于，因为它们是既定设计而非缺陷：

- Agent 在你已批准的工具调用允许范围内所做的事，包括 `allow-all` 模式下的破坏性命令。
- `[command_policy]` 沙箱没能拦住它从未声称覆盖的命令。文档中它被定义为审批边界上的一份 deny 列表，
  并明确说明它不是文件系统权限，也不是隔离层——见
  [配置 → 命令策略](https://penguin.ooo/docs/configuration)。真正的隔离（bubblewrap、dsh）是另一层。
- 有意暴露到不该暴露的网络上的 server。PenguinHarness 默认绑定 `127.0.0.1`，把它放到公网地址上是一项
  部署决定。
- 已经拿到你的用户账号或数据根目录的人能够读到磁盘上的密钥。
- 模型 Provider、MCP Server 或其他第三方依赖自身的漏洞——请报告给它们各自的维护者。如果某个依赖的缺陷
  能通过 PenguinHarness 以其维护者不会视为 bug 的方式被利用，也请一并告知我们。
