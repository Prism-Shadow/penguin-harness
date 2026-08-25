# Interface contracts split by which side of the engine needs them

- **Date:** 2026-08-24
- **Type:** refactor
- **Scope:** `core`, `server`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)
- **Breaking:** yes — `SubagentHandle.run` and `sendToBackgroundSubagent` take an OmniMessage list instead of a string, and the build/version types left the `/interfaces` subpath

[中文版](2026-08-24-interfaces-split.zh.md)

`packages/core/src/interfaces.ts` held four unrelated groups in one 749-line file, with the
build/version types physically splitting the Environment section in half. It is now a
directory, divided by which side of `context_engine` needs each contract, and the
message-versus-control division that runs through all three boundaries is written down.

## The split

- `interfaces/llm.ts` — the model-request contract (`GenerativeModelConfig`,
  `GenerativeModelParameters`, `LLMOutcome`, `LLMInterface`).
- `interfaces/environment.ts` — tool execution, configuration, the subagent contracts, and
  the management-plane API.
- `interfaces/shared.ts` — the vocabulary both sides genuinely need: `ToolDefinition`,
  `ThinkingLevelName`, `ApproveFn`, the command policy.
- `interfaces/index.ts` — the barrel, still the published
  `@prismshadow/penguin-core/interfaces` entry, so existing imports keep working.
- `version-info.ts` — `BuildInfo` / `HarnessInfo` / `VersionReport` and friends, which
  describe neither contract; they ship from the package root now.

## Two planes, stated

The docs page ([Core Interfaces](/interfaces)) now states what crosses each boundary. The
**content** is OmniMessage and nothing else. Alongside it runs a **control plane** that is
deliberately not message-shaped — `signal`, `thinkingLevel`, `approve` and its
`ApprovalDecision`, and `streamGenerate`'s `LLMOutcome` return value — each with the reason
it stays a parameter. Environment's remaining non-message members are named as its
**management plane**: `listTools`, `toolPermission`, the background-command and subagent
listings, their stop/steer entry points and the listener attachments — none of which pass
through the engine at all, since they serve Session assembly and a host's own UI.

## One vocabulary into a subagent

`SubagentHandle.run` took a `prompt: string` while the same handle's `steer` took
`OmniMessage[]`, and `sendToBackgroundSubagent` took a `text: string`. Both now take the
OmniMessage list `Session.run` takes.

The caller owns each message's `sender`, which fixes a mis-attribution: a round started from
the subagents panel on an idle child was stamped `parent_agent`, recording the user's own
words in the child's Trace as if the parent agent had dispatched them. Only the model's
dispatch stamps `parent_agent` now; a panel message carries no sender, matching what the
panel's steering path already did.

## Compatibility

No stored data or configuration is affected, and no host-visible behavior changes apart from
the `sender` fix above. Two source-level breaks for SDK embedders:

- An embedder providing its own `SubagentRunner` must change `run({ prompt })` to
  `run({ messages })` — `messages` is the round's input in the shape `Session.run` takes
  (`[userText(prompt, "parent_agent")]` reproduces the old behavior exactly). The same
  applies to a custom `EnvironmentInterface.sendToBackgroundSubagent`.
- `BuildInfo`, `BuildRuntimeInfo`, `HarnessInfo`, `HarnessSource` and `VersionReport` are no
  longer exported from `@prismshadow/penguin-core/interfaces`; import them from
  `@prismshadow/penguin-core`.

No compatibility shim is kept for either: both are compile-time errors with a one-line fix,
and a dual-shape `run` argument would have re-introduced the ambiguity this change removes.
