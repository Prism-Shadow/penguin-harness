# Landing trace screenshots: same opened timeline in English and Chinese

The English trace screenshots showed the empty "select a Session" state while the Chinese ones showed a full trace; all four now capture the same opened trace with stats and an execution timeline containing tool calls.

- The capture script navigated to `/traces?sessionId=...` — but the traces page only honors the session deep link when `agentId=` is present (the product's own links always carry both), so selection relied on a fragile title click that silently failed for English via `.catch()`. The script now uses the canonical `?agentId=default_agent&sessionId=...` deep link and waits for the timeline's `exec_command` lanes before shooting, so an empty capture fails loudly instead of shipping.
- The scripted English session title was 31 chars and core clips titles at `TITLE_MAX_CHARS = 30`, producing "…Agent ap" in the shots; the mock title is now "Build a data-analysis Agent" (27 chars).
- Regenerated `traces-{en,zh}-{light,dark}.webp`; chat and benchmark shots are unchanged.
