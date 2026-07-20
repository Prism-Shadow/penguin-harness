# Upgrade AgentHub to 0.4.0 and adopt the opaque fidelity payload

@prismshadow/agenthub 0.3.3 -> 0.4.0 (agenthub PR #159): content items replace the item-level
`signature`/`phase` fields with one opaque `fidelity` object, and OmniMessage now carries it
verbatim end to end — Trace, replay, and resume included; the `agenthub-dev` skill joins the
built-in library.

## Details

- OmniMessage complete payloads (text, thinking, inline_data, inline_thinking, tool_call)
  replace `signature?: string` / `phase?: string | null` with `fidelity?: Record<string,
  unknown>` — an opaque wire-fidelity payload written to the Trace as-is and passed back
  verbatim on replay (Claude thinking signatures, GPT-5 encrypted reasoning `{id,
  encrypted_content}` and `{phase}` markers, the OpenAI-compatible `{reasoning_field}` name).
  Builders take the object directly; an empty object is treated as absent.
- GenerativeModel's streaming translator mirrors AgentHub baseClient aggregation: a thinking
  block is closed by its fidelity payload and a run of equal fidelity is one block (the
  OpenAI-compatible clients stamp every thinking delta with the same `{reasoning_field}`,
  which must not split blocks — this carries agenthub's reasoning-field replay fix through
  PenguinHarness so multi-turn conversations against strict OpenAI-compatible upstreams
  survive); a text segment splits on a differing `fidelity.phase` and closes on
  `fidelity.signature`, merging fidelity keys. Text-phase stickiness across segments is gone
  (mirrors baseClient).
- The `agenthub-dev` skill (AgentHub's own model-support development workflow) is installed
  into the built-in library under the Penguin Development group, completed to the library
  contract (version/updated frontmatter, short descriptions, a "Before you start" section,
  and a custom icon).
- Malformed-classification fix for 0.4.x: agenthub now surfaces truncated streamed tool-call
  arguments as its own `ToolCallArgumentParseError` (previously a raw `SyntaxError`) and
  thinking-only completions as `EmptyResponseError`; `isMalformedJsonParseError` recognizes
  both (instanceof + name fallback + cause chain), so these still end as `malformed` and the
  engine reconnects and retries instead of failing the turn (caught by the malformed e2e).
- Docs (omni-message, interfaces, sessions-and-traces; en + zh) and the design specs updated
  to the fidelity semantics.
- Traces written before this change carried `signature`/`phase` on payloads; per the
  pre-release no-migration policy they are not converted (old fields are ignored on replay —
  resume of such Sessions loses provider fidelity; delete and recreate if needed).
