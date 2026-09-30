# 历史窗口带上其起点所在上下文的模型

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`, `web`, `docs`

[English](2026-09-30-history-window-context-model.md)

`GET /api/sessions/:sessionId/messages` 的窗口式读取若从某个模型上下文的中途开始，响应里并不说明这个上下文运行在哪个模型上：记录模型的 `session_meta` 位于该上下文 Trace 文件的开头，在窗口之前。[会话内切换模型](2026-09-16-in-session-model-switch.zh.md)之后，Web App 因此把这类窗口开头几个 Task 的费用按 Session 当前模型计价；旧上下文始于窗口之前的那次切换，也不显示「模型已切换」标记。现在分页信息带上了这个模型。

## 细节

- 窗口式响应新增 `page.contextModel`（`{ provider, modelId }`）：窗口第一个单元所在 Trace 文件开头那条 `session_meta` 所记的模型；Session 还没有 Trace 时不带。为此不重复任何记录，各窗口仍然恰好拼成完整的消息历史。
- Web App 加载的每个窗口（尾部窗口与每个更早的分页）都以这个模型为起点：无论窗口从哪里开始，Task 的费用估算都按它实际运行的模型计价；窗口内的切换即使其旧上下文始于窗口之前，也会显示标记。
