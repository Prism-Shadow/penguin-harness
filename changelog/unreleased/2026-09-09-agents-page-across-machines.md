# The Agents page lists every machine's Agents

- **Date:** 2026-09-09
- **Type:** feat
- **Scope:** `web`
- **PR:** [#653](https://github.com/Prism-Shadow/penguin-harness/pull/653)

[中文版](2026-09-09-agents-page-across-machines.zh.md)

An Agent belongs to the Project, but its state directory is created on whichever machine it has run on. One that has only ever run on a machine therefore exists only over there — and the Agents page, built from this server's list alone, had no row for it. There was nothing to click, nothing to say it existed, and the Evaluation Center had nowhere to hang its Benchmarks (which is how it was found).

The page now asks this server and every machine it holds a connection to, and merges the answers by agent id — the same fold the Evaluation Center uses. This server describes an Agent it also has; one that lives on exactly one machine is named for it, `[SSH: prod-1]` beside the name in the machine's own casing.

What such a card can do is what a machine can answer. **New chat** opens the draft against that machine, with the temporary workspace ON it, so the conversation starts where the Agent's state is. Everything else on the card — settings and its stat shortcuts, usage, delete — reads or writes a state directory this server does not have, so it is inert, with the reason on hover rather than a 404 after the click.
