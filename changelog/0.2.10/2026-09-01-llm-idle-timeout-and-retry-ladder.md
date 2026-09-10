# An LLM request times out on silence, not on length

- **Date:** 2026-09-01
- **Type:** fix
- **Scope:** `core`, `web`, `docs`
- **PR:** [#571](https://github.com/Prism-Shadow/penguin-harness/pull/571)

[中文版](2026-09-01-llm-idle-timeout-and-retry-ladder.zh.md)

`model.timeoutMs` has always measured the wait for the **next** upstream event: the timer runs only while awaiting the gateway, resets on every event, and never counts consumer-side time. It was documented as "per-Request timeout", which reads as a cap on how long a response may take. The two readings agree on a model that streams as it writes. They part company on a model that keeps its reasoning off the wire — GPT-5 and Gemini send nothing at all while they think, so the whole thinking phase lands in the single gap before the first event, and 120000 quietly meant "thinking may not exceed two minutes". A request cut off there produces no usage, and the retry goes silent in exactly the same place.

## Details

- The wording now says what the value is: an idle budget between upstream events, bounding the connect and first-event wait and the gaps between events, not the request's total duration. Same text in the configuration table, the interface listing, and the agent settings field.
- The default is **300000**, up from 120000. That is a kernel change (generation `2026-09-01`, runtime tab): an existing Agent whose runtime tab is still the built-in default picks the new value up on a kernel update, while one the user has edited keeps what it says.
- Every request now asks for thought summaries (`thinking_summary`). No provider rejects the flag — the gateway maps it where the family has one and drops it where it does not — so reasoning reaches the wire wherever it can: the reader gets to watch the model think, and the idle timer keeps being reset while it does. Two families read it as something more specific: the Claude family switches its thinking stream to summarized, and some Gemini models accept `include_thoughts` and still return no summary. The raised default is what covers the ones that stay silent.

## Retries count consecutive failures, not failures

The reconnect ladder gave up after 5 retries within one turn, whatever happened in between. A drop like `terminated: other side closed (UND_ERR_SOCKET)` usually lands mid-response, after the model has already written part of its answer — an attempt that connected and produced content, which the old count read as one more piece of evidence that the endpoint was unreachable.

- An attempt that **received content** — anything at all, a cut-off thinking block or half a tool call's arguments included — now resets the ladder: the next drop starts from the 2s rung again. `[turn_retried]` carries everything produced so far into each retry, so a turn retried this way keeps moving forward instead of repeating itself.
- What bounds that reset is a separate absolute ceiling of **20 attempts per turn**, which only an endpoint that streams a little and drops every single time ever reaches.
- `attempt` on `request_end` still counts every attempt and never rewinds, so the "attempt N" the Web App and the CLI print stays monotonic — and the announced `retry_in_ms` still matches the wait that actually follows, reset included.
- The compaction loop shares the retry budget but not the reset: its budget also covers a response that was committed but unusable (an empty summary, or one that called tools), and there "produced content" is not evidence of progress at all.
