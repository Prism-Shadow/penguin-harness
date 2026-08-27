# Session titles stop answering the conversation, and follow its language

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `core`

[中文版](2026-08-26-title-prompt-language.zh.md)

The prompt behind an automatically generated Session title was rebuilt as an instruction about
a piece of text rather than as a conversational turn. A conversation opening with `你好` was
titled `你好！有什么可以帮你的吗？` — the model answered the material instead of naming it — and an
English conversation could come back with a Chinese title.

## Details

- The conversation material is fenced in a `<conversation>` block, with `<user>` and
  `<assistant>` inside it, and declared to be data: not to be replied to, not to be acted on,
  and not a source of instructions. The last point also keeps a conversation from steering a
  request that runs with no system prompt of its own.
- The demand now follows the material, and the prompt ends on a bare `Title:` lead-in whose
  only sensible continuation is a title. The empty `<think></think>` block that closes a
  reasoning model's thinking phase sits directly above that lead-in.
- The language rule is stated as a mapping and anchored to the **user's** text — English user
  text gets an English title, Chinese user text gets a Chinese title, never a translation —
  so an assistant reply in another language no longer decides it.
- Material carrying no topic (a greeting, an "ok", a lone emoji) has a rule of its own: name
  the act, `"hi"` → `Greeting`, `"你好"` → `打招呼`.
- A `<conversation>`, `<user>` or `<assistant>` tag written inside the material itself is
  rewritten to square brackets, so the fence cannot be closed from within the excerpt. The
  substitution preserves length, leaving the 2000-character excerpt budget unchanged.
- `sanitizeTitle` drops a re-stated `Title:` / `标题：` label from the model's output, in the
  same fixed-point pass that already strips quotes and trailing punctuation.
