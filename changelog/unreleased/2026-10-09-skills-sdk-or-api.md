# Skills ask whether a program embeds its agent with the SDK or calls it over the Agent API

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `plugins`, `docs`

[中文版](2026-10-09-skills-sdk-or-api.zh.md)

A program reaches a Penguin agent in one of two ways: embedded with the SDK, `@prismshadow/penguin-core`, which runs the basic agent loop without the Penguin server, or through the server's Agent API over AMSP, with the `@prismshadow/amsp` client or curl. The skills that build agent applications and create agents described both ways and asked the user which one before building. The `agent-development` and `agent-tuning` plugins moved to `2026.10.09.1`.

## Details

- **`penguin-sdk`** opened with *Two ways to reach an agent*: for each way, what it is, what it gives, what it lacks or requires, and when to choose it. Whenever the user asked to connect a program to an agent, or to build a program with an agent in it, the skill asked which way first, even when the request was otherwise concrete. The question was one a2ui choice block, which the Web App rendered as two buttons and the CLI and the messaging channels as a numbered list. It was not asked when the user's message or an earlier answer had already chosen, nor for workflows or Remote-control bots. After it, the skill's no-follow-up-questions default held as before.
- The existing SDK content moved, unchanged, under *The SDK path*, its verification steps included. A new *The API path* section and `reference/agent-api.md` covered the other way: the steps the Project's owner takes on the Agent's **API** tab or with `penguin agent api`, the approval mode to suggest, the Base URL (`localhost`, not `127.0.0.1`), the Agent ID as `<projectId>/<agentId>`, the `AgentClient` with `ask`, `run`, Session continuation and `onApproval`, curl, the errors, and the checks before handing over.
- The agent never turned on an Agent's API access or keyless access, never changed its approval mode or the server-wide switch, and never created or deleted keys, although the token in its shell could have allowed it. It asked the user and showed where. The key stayed in the `PENGUIN_AGENT_KEY` environment variable, out of the code and out of the chat.
- **`agent-initialization`** asked the same question when the requested agent was for a program. On the SDK path it handed over to `penguin-sdk` and configured the program's embedded agent; on the API path it created the Agent in the Project and reported the owner's steps, the Agent ID and the Base URL.
- **`penguin-orchestration`** listed `penguin agent api` among its cautions: the read-only commands were the agent's to run, the changing ones the owner's.
- The `agent-development` plugin's descriptions and the docs' Skills page named the Agent API next to the SDK.
