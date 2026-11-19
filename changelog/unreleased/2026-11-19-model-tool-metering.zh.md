# 模型工具的计量单位与费用估算

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [#1615](https://github.com/Prism-Shadow/penguin-harness/pull/1615)

[English](./2026-11-19-model-tool-metering.md)

`penguin tools usage` 显示服务商上报的用量，在查看记录时估算费用。失败请求也会保留服务商已经上报的用量。缓存命中、未命中缓存的输入、思考和响应这四类 token 分别计算一次。

DeepSeek 语音识别按计费秒数、语音合成按计费字符数、搜索和网页读取按成功请求数计价。Jina 按输入 token 计费，Fish Audio 语音合成按 UTF-8 字节数计费。估价采用所选服务商的费率，并考虑请求发生时适用的优惠。按 token 计费的输出支持项目自定义单价。

混合生成的图像和文字按图像输出单价估算。按张计价的服务采用实际返回的图片数量。服务商有两档可能的价格时显示估价范围。缺少单价或计量依据时，估价显示为未知。
