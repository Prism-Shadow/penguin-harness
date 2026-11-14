# base URL、API key 与价格留空时说明会发生什么

- **Date:** 2026-10-24
- **Type:** fix
- **Scope:** `web`, `model-catalog`, `docs`
- **PR:** [#1316](https://github.com/Prism-Shadow/penguin-harness/pull/1316)

[English](2026-10-24-model-field-placeholders.md)

模型弹窗和分组设置里，空着的 base URL 字段换了占位文字。分组设置没有填上时，占位文字改为「留空使用默认 base URL」（英文 "Leave blank to use the default base URL"），原先是「未设置：使用客户端默认端点」。

API key 字段不再留空。留空的 key 无从兜底时，占位文字为「请填写 API key」（英文 "Enter an API key"）。无从兜底指没有已存的 key、分组密钥借不到，服务端也没有报告对应的环境变量已设置。此前这样的字段没有占位文字，例如服务端没有设置 `DEEPSEEK_API_KEY` 时的 DeepSeek。模型的客户端不带 key 也能调用其端点时，占位文字改为「留空则不使用 API key」（英文 "Leave blank to use no API key"）。这包括 vLLM 服务器（发送 vLLM 的占位 key `EMPTY`）和自建的 MMSP 服务器，不包括 Penguin Go 的中转。目录的 `providerCalledKeyless` 与 `modelCalledKeyless` 依据 MMSP 的凭证表判断这一点。

模型弹窗的三项价格字段，占位文字为「留空则不计算费用」（英文 "Empty = not costed"）。不带价格保存的模型不计入任何费用。

## 细节

- 模型库页面上必填的 base URL 字段为空时，占位文字都是「请填写 base URL」（英文 "Enter a base URL"），共三处：组内有模型没有自己 base URL 的 Custom 或你创建的分组的分组设置、所在分组没有 base URL 的模型的模型弹窗，以及新增分组弹窗的「导入模型」。有已存的值时，输入框显示该值。留空不能保存，输入框下方显示「必须填写 base URL」。分组设置和模型弹窗里「保存」保持禁用，导入时「检测协议」和「批量导入模型」保持禁用。此前模型弹窗和导入在必填且留空时显示 `https://…`，分组设置显示「未设置」的文字。
- 其余 API key 占位文字及其先后顺序不变：先是「留空保留现有 key」，其次「留空继承分组设置」，服务端报告变量已设置时为「留空则使用环境变量 DEEPSEEK_API_KEY」，最后是分组密钥不适用于该模型时的说明。
- 模型文档页引用的是新的措辞。
