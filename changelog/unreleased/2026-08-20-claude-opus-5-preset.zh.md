# 直连 Anthropic 分组补上 Claude Opus 5

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `model-catalog`, `core`, `docs`, `skills`
- **Issue:** [#352](https://github.com/Prism-Shadow/penguin-harness/issues/352)

[English](2026-08-20-claude-opus-5-preset.md)

内置模型目录的直连 Anthropic 分组里没有 `claude-opus-5`，而它在 OpenRouter 上的对应条目 `anthropic/claude-opus-5` 早已收录。这次补上了直连预设，同时按 Anthropic 公布的价目表重新核对了该分组其余条目。

## 细节

- 新条目为 `provider = "anthropic"`、`model_id = "claude-opus-5"`，展示名 Claude Opus 5，1,000,000 Token 上下文，支持视觉，每百万 Token $0.50 / $6.25 / $25（缓存读取 / 缓存写入 / 输出）——即 Anthropic 的 $5 基础输入价，按本分组 1.25 倍缓存写入的口径换算，于 2026-08-20 从 https://platform.claude.com/docs/en/about-claude/pricing 读取。它与 OpenRouter 条目分毫不差。
- 该条目位于 `claude-fable-5` 与 `claude-opus-4-8` 之间：目录按 model id 的字典序排列、同一系列的新版本在前，顺序全部手工预先算好，与 OpenRouter 的 Claude 条目本就采用的顺序一致。
- 与其余直连 Anthropic 预设一样，它既不固定 `client_type` 也不固定 `base_url`。AgentHub 会依据 id 把 `claude-opus-5` 自动路由到原生 Claude 客户端，凭证留空时回退到 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`，快速模式开关按 Anthropic 协议提供（`speed: "fast"` 加上 beta 请求头）。测试固定了这三点，也固定了该条目的确切位置、价格、上下文窗口与视觉标记。
- 目录的唯一键是 `(provider, model_id)` 组合，因此直连条目与 OpenRouter 条目可以并存；新增的测试固定了两者共用同一个展示名，正如 Fable 5 与 Sonnet 5 这两对早已如此。
- 同分组其余五个条目按同一页面重新读取后维持原值：Claude Fable 5 $1 / $12.50 / $50，Opus 4.8 与 Opus 4.7 $0.50 / $6.25 / $25，Sonnet 5 $0.20 / $2.50 / $10，Sonnet 4.6 $0.30 / $3.75 / $15。Sonnet 5 输入输出的 $2 / $10 是标准价而非上线优惠价，这正是它比 Sonnet 4.6 便宜的原因；新增的回归测试与目录注释说明了这一点，免得这处倒挂被当成抄错。同一条注释还记下：Anthropic 对整个 1M 窗口按单一费率计费，而 Opus 5 / Opus 4.8 的快速模式溢价（$10 / $50）属于目录不予记录的另一档。

## 文档与 Skill

- 中英文 `models` 文档页在预置目录的示例清单中列出了 `claude-opus-5`。
- `agenthub-models` skill（v13）把 `claude-opus-5` 加进官方 Claude 5 id 一列，与表中本就有的网关变体 `anthropic/claude-opus-5` 并列。

## 兼容性

既有 Project 不会自动获得这个预设：预设是在 Project 创建时复制进 `.project_config.toml` 的，此后没有任何机制会改写它们。对已经存在的 Project，请在模型页面使用**同步预设**把该条目引入——它只会追加 Project 缺少的目录条目、并更新已有条目中由目录所有的字段，不删除任何内容，也不会改动已存的默认模型与任何凭证。
