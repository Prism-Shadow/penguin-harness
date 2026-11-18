# 成本中心统计模型工具请求

- Date: 2026-11-19
- Type: fix
- Scope: server, web
- PR: [#1616](https://github.com/Prism-Shadow/penguin-harness/pull/1616)

[English](2026-11-19-tool-requests-cost-center.md)

成本中心的请求数与成功率包含模型工具调用。服务商拒绝的请求计为失败，用户取消已提交的请求时会从成功率分母排除。属于会话的调用也会出现在对应 Agent 的统计中。

图像生成按模型当前价格估算成本。服务商未返回计费分辨率时显示价格范围。语音时长、字符数等计量保存在工具用量中，Token 总数只累计以 Token 为单位的用量。
