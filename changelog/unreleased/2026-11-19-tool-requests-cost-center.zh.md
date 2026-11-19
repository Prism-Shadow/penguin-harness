# 成本中心统计模型工具请求

- Date: 2026-11-19
- Type: fix
- Scope: server, web
- PR: [#1616](https://github.com/Prism-Shadow/penguin-harness/pull/1616)

[English](2026-11-19-tool-requests-cost-center.md)

成本中心的请求数与成功率包含模型工具调用。服务商拒绝的请求计为失败，用户取消已提交的请求时会从成功率分母排除。属于会话的调用也会出现在对应 Agent 的统计中。

费用按服务商的计费单位估算，包括 Token、语音识别秒数、语音合成字符数、图片张数和搜索次数。失败请求如果已产生用量，也会计入估算。Token 总数只累计实际 Token。图像服务未返回计费分辨率时显示价格范围。

Jina 搜索和网页读取请求实际使用对应的官方端点时，按 MMSP 参考价估算。通过自定义端点发出的请求会保留 Token 用量，配置项目单价后可查看费用。
