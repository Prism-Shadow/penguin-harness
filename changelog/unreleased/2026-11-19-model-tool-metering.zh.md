# 工具用量的计量单位和生图估价

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [#1615](https://github.com/Prism-Shadow/penguin-harness/pull/1615)

[English](./2026-11-19-model-tool-metering.md)

`penguin tools usage` 保留服务商上报的用量，并标明可确认的输入单位。DeepSeek 语音识别按计费秒数记录，DeepSeek 语音合成按计费字符记录，Fish Audio 语音合成按 UTF-8 字节记录。DeepSeek 搜索没有返回结果时，计费请求数为零。

生图用量按当前项目或模型费率估算美元金额。普通响应文本采用图像输出单价，单独上报的思考用量采用思考单价。按张计价的服务采用实际返回张数。有两档价格且服务商没有标明实际档位时，显示估价范围。缺少费率或用量时，估价显示为未知。
