# 会话标题仅由用户输入生成,并即时写入 fallback

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`

[English](2026-08-20-title-from-input.md)

重做了 Session 标题的自动生成,使其完全不等待模型输出。Task 一开始,用户输入的前几个词就被持久化为 fallback 标题并推送到界面;同时在后台发起 LLM 标题请求,材料只含用户输入,生成成功后替换 fallback。此前标题要等回答流式输出到一定长度(或 Task 结束)才出现,且生成 prompt 可能包含助手文本。

## 细节

- fallback 截断改为按词处理:较长的英文输入在词边界截断而不再从单词中间切开,CJK 输入按字截断,行首标点不再占用长度预算。
- 手动重命名为最终值:LLM 结果只会替换生成器自己写入的 fallback;LLM 失败后 fallback 仍在时,下一次 Task 开始会重试请求。
- subagent 的标题改为在注册时由派生它的 `run_subagent` prompt 生成,不再等父会话运行结束后用 subagent 的输出汇总生成——运行途中即可看到 subagent 标题。
