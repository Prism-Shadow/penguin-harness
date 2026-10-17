---
title: "Keeping the Prompt Cache Hot: How PenguinHarness Catches Cache Misses in CI"
date: 2026-10-16
category: practice
excerpt: "An agent resends its whole context on every request, and the provider bills that repeated prefix at a tenth of the input price only while each request repeats it byte for byte. A miss slows nothing down and fails no test; it shows up on the bill. This post explains how PenguinHarness keeps each request an extension of the last, and how its test system names the request that stopped hitting, the part of the prefix that moved and the tokens it cost, with experiment tables from the harness's own cache simulator."
---

> Written for PenguinHarness 0.2.16. The numbers come from the harness's cache simulator, which applies Anthropic's published caching rules to recorded requests. They are not measurements of a live provider.

An agent harness sends the model nearly the same request over and over. Each one carries the system prompt, the tool definitions and the whole conversation so far, and only the last turn is new. Providers make this cheap with prompt caching: a prefix they have processed recently is served from a cache of its KV state at a fraction of the input price. The condition is strict. The cache serves a prefix only while each request repeats the previous one byte for byte from the front.

PenguinHarness treats that condition as an engine requirement, and a cache miss as a regression that a test must catch. This post covers both: the rules that keep each request an extension of the last, and the test system that reports, in provider token counts, when a change breaks them.

**TL;DR**

- A cache miss is invisible. The answer is the same, nothing on screen changes, and CI stays green. At Anthropic's standard rates, a token written to a 5-minute cache entry costs 12.5 times as much as a token read from one, so a miss late in a long conversation bills the whole history again.
- The test system has four parts: a recorder that captures the exact request a real `GenerativeModel` would send, a diagnostic that names the earliest point where two consecutive requests diverge, an Anthropic-shaped simulator that turns recordings into `cache_read_input_tokens` and `cache_creation_input_tokens`, and a suite that drives a real `Session` through its lifecycle and asserts that every request reads back its predecessor's whole prefix.
- Across 14 Session scenarios run through the same helpers (steering, retries, interruptions, background notices, resume, compaction, subagents, model switches), every request reads back its predecessor's prefix except in three cases: where the harness changes the prefix on purpose (a thinking-level change, a new context, a subagent, a model switch), where an interrupted turn's text is rewritten, and where an entry expires.
- Injected anti-patterns show the price. A timestamp in the system prompt or a tool list in random order makes every request miss and multiplies input cost by 4.2 over a ten-request task. A one-word edit to a tool description, made once, costs 1.3 times the baseline.
- With the single automatic breakpoint sent today, the first request after a thinking-level change or a compaction pays for the tools and the system prompt again, even when both go out byte-identical. Explicit breakpoints after them would recover that prefix, but only for a part that clears the provider's minimum cacheable size.

## Why an agent depends on the prefix cache

Take the tool loop from the experiments below: one task, six tool rounds, seven requests. The seventh request carries 11,027 tokens, and 9,470 of them are exactly what the sixth request already sent. Over the whole task, 33,474 of the 44,501 input tokens repeat an earlier request.

Prefix caching turns that repetition into a discount. On Anthropic's API, reading cached tokens costs 0.1 times the base input price (less on a few of the newest models). Writing them to an entry with the default 5-minute lifetime costs 1.25 times. A request that misses pays the write price on its entire prefix.

A miss is also silent. The model receives the same tokens and gives the same answer. Latency rises a little, the screen looks the same, and no assertion fails. It shows up only in the usage report and, a month later, on the invoice. It does not stay local either: a harness change that moves the prefix moves it in every running conversation, on every request.

## How prefix caching works

PenguinHarness reaches providers through MMSP (`@prismshadow/mmsp`). The rules below are Anthropic's, because Anthropic documents them in the most detail and our simulator implements them. Other providers cache under their own rules, but all of them require the prefix to repeat exactly.

- **Order.** A request is cached as one prefix in a fixed order: tools, then the system prompt, then the messages. A change invalidates everything after it.
- **Breakpoints.** The cache is written at breakpoints (`cache_control`), up to four per request. Automatic caching places one breakpoint at the last cacheable block and moves it forward as the conversation grows. MMSP's Claude client sends exactly that: a single top-level `cache_control: {"type": "ephemeral"}`.
- **Lookback.** A read checks the prefix ending at each breakpoint, then walks back over at most 20 positions per breakpoint, counting the breakpoint itself as the first. A run of consecutive `tool_use` blocks, or of `tool_result` blocks, counts as one position.
- **Minimum size.** A shorter prefix is not cached at all. The minimum depends on the model: 1,024 tokens for Claude Sonnet 4.6, and from 512 to 4,096 across current models.
- **Lifetime.** An entry lives five minutes and is refreshed for free each time it is read. A one-hour lifetime costs twice the base input price to write; PenguinHarness does not request it.

What survives a change follows from the order:

| What changes | Tools | System prompt | Messages |
| --- | --- | --- | --- |
| The model | lost | lost | lost |
| A tool definition (name, description, schema or order) | lost | lost | lost |
| Fast mode (`speed`) | kept | lost | lost |
| The system prompt | kept | lost | lost |
| `tool_choice` | kept | kept | lost |
| Thinking parameters | depends on the model | depends on the model | lost |
| An earlier message | kept | kept | kept up to the edit |

"Kept" means the bytes still match. For the provider to read them back, an entry must also end there, and an entry ends only at a breakpoint. Experiment 3 shows why that matters.

Anthropic also offers [cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics): send the previous response's id, and the API reports the first divergence as `model_changed`, `system_changed`, `tools_changed` or `messages_changed`, with an estimate of the input tokens after it. Our test diagnostic uses the same vocabulary.

## What the engine does to keep requests append-only

Prefix stability is easiest to lose wherever a harness does something other than append a turn. Each of those places has a rule in PenguinHarness's engine.

- **The prefix is fixed for a model context.** The system prompt, the toolset (MCP tools included) and the model are assembled when a context opens and stay unchanged until it closes. If the user or the agent itself edits `AGENTS.md`, a Skill or an MCP Server mid-conversation, the change takes effect in the next context. The prompt is recorded in the Trace's `session_meta`, and resuming an open context reuses those bytes. The `Date:` line of the default system prompt holds a calendar date filled in when the context opens, so it never changes from one request to the next. Fast mode is a property of the context's model object, so it does not change inside a context either.
- **History is append-only.** The MMSP client holds the committed history, and the engine only appends to it. The compaction request goes out on the same model object with the same configuration, plus one appended user turn that holds any pending tool results and the compaction prompt, so it reads back the turn it follows. If a compaction attempt produces an unusable summary, it is retried with a corrective note appended, not by rewriting what was sent.
- **Steering rides the tool-result turn.** A message the user sends while a task is running is delivered as a `[user_steering]` block in the same user turn as the tool results of the round in flight. The request still only appends.
- **Interruptions and retries add after, never rewrite before.** When a request is interrupted, the tool results it carried stay structured, and everything else about the interrupted turn, including the model's partial output, is flattened into a `[turn_aborted]` block in the last user message. When a stream drops and the engine reconnects, it resends the original input and appends a `[turn_retried]` block that carries what the failed attempt produced. Either way, nothing before the last user message changes.
- **The thinking level is the one parameter that moves inside a context.** It applies from the next request, so it costs one miss and then holds; the compaction request and the next context use the moved level too. The Web App warns before the switch and offers **Compact, then switch**.
- **A model switch compacts on the old model.** The summary is an ordinary compaction request on the old model, which reads back its own prefix. The new model starts a new cache line, because the cache belongs to one model.
- **`max_tokens` is recomputed for every request and stays out of the key.** The harness caps it at the room left in the context window, so it shrinks once that room falls below the configured cap. It is not part of the cached prefix.

## The bug that started the test suite

Not all of these rules have always held. Until [PR #700](https://github.com/Prism-Shadow/penguin-harness/pull/700), the compaction request was the one request that ignored the thinking level the user had pinned: it went out at the level the context had opened with. The reason was the cache. Compaction fires when the context is largest, and holding its parameters fixed was meant to keep its prefix identical to the context it summarizes. Once the user had moved the level, though, every subsequent turn had gone out at the new level. The compaction request was then the only request whose prefix differed, and it differed at the moment the prefix was largest.

#700 made the compaction request use the Session's level. A test did cover this request, but it asserted the old behavior as the contract: `engine.test.ts` expected the levels `["high", "high", undefined]`. Nothing measured what that contract cost. [PR #722](https://github.com/Prism-Shadow/penguin-harness/pull/722) added the test system described below, and the invariant is now pinned: a thinking-level move costs exactly one `parameters_changed`, and the compaction request carries the moved level.

Replayed through the simulator, the two behaviors look like this. The Session runs one task, moves the thinking level, then runs a four-round task that crosses the compaction threshold:

| Compaction request | Prefix | Read from cache | Written | Hit ratio | Diagnostic |
| --- | ---: | ---: | ---: | ---: | --- |
| At the Session's level (today) | 7,985 | 7,945 | 40 | 99.5% | none |
| At the context's opening level (before #700) | 7,977 | 3,241 | 4,736 | 40.6% | `parameters_changed [output_config]` |

In this short context, the old behavior still found an entry written before the move within its 20-position lookback. In a longer context, it would have read nothing.

## A test system for cache misses

The design question was where to measure. A live API gives real numbers, but it costs money on every run, varies from run to run, and needs keys that contributors and CI forks do not have. A plain unit test of request assembly is free and deterministic, but it tests the harness's idea of a request rather than the bytes that reach the provider. We wanted both properties, so the system splits the problem into the harness's half and the provider's half. The code is in [`packages/core/test/helpers/prompt-cache/`](https://github.com/Prism-Shadow/penguin-harness/tree/v0.2.16/packages/core/test/helpers/prompt-cache).

### Record the request as it goes on the wire

`recordingModel` (`recording.ts`) builds a real `GenerativeModel` and replaces one thing: the provider client's network stream, which reads from a script instead. Everything above it runs for real. The model assembles its config, MMSP merges the input into its stateful history, and the provider client's own transforms produce the request. What gets recorded is the request body the client would have sent: messages in Anthropic's shape, and a config with `tools`, `system`, `thinking` and `cache_control`.

A scripted reply streams the way a Claude response does: thinking closed by its signature, then text, then tool calls. It can end cleanly, drop the connection after its text so that the engine reconnects, or hang until the caller aborts. Scripted replies always report zero cached tokens. What a provider would have served is computed afterwards, from the recordings.

### Name the earliest divergence

`diagnoseCacheMiss(prev, next)` (`diagnostics.ts`) compares two consecutive recordings and returns the earliest level at which `next` stops extending `prev`, in the precedence Anthropic's diagnostics use: the model, the system prompt, the tools, the other prompt-affecting parameters, then the messages. It ignores `max_tokens`, `stream` and the `cache_control` marker, because none of them is part of the cached prefix.

```ts
type CacheMissReason =
  | { type: "none" }
  | { type: "model_changed" }
  | { type: "system_changed" }
  | { type: "tools_changed"; detail: string }
  | { type: "parameters_changed"; keys: string[] }
  | {
      type: "messages_changed";
      index: number;
      detail: string;
      cache_missed_input_estimate: number;
    };
```

A tool divergence says whether the names changed or which definition changed. A message divergence gives the message index, its role, the first differing block, and an estimate of the input after it at four characters per token. `parameters_changed` is our addition: when `thinking`, `output_config` or `tool_choice` changes, Anthropic's diagnostics answer `unavailable`, and we wanted the key named. Ours also covers the fast-mode `speed` and `betas`.

The diagnostic answers whether a request changed. It cannot say whether the cache hit: an expired entry, a lookback that falls short and a prefix under the minimum all leave the bytes unchanged.

### Replay through an Anthropic-shaped cache

`PromptCacheSim` (`simulator.ts`) is a rule engine over the recordings. It reports what a provider with Anthropic's rules would have read back, in the provider's own fields: `cache_read_input_tokens`, `cache_creation_input_tokens` and `input_tokens`.

- **Blocks.** A request becomes one ordered block list: the model id, one block per tool definition, a virtual block for the fast-mode parameters (`speed`, `betas`), the system prompt, a virtual block for the remaining prompt-affecting parameters, then every content block of every message. That order reproduces the table above.
- **Positions.** A run of `tool_use` blocks, or of `tool_result` blocks, is one position; every other block is its own.
- **Writes only at breakpoints.** A request writes one entry per breakpoint, holding the hash of the prefix that ends there; the entry becomes readable when the request completes. By default there is one breakpoint, at the last block, as MMSP sends. The `breakpoints: "tools-system-automatic"` option adds explicit ones after the last tool and after the system prompt, so a test can measure what they would recover.
- **Reads.** Each breakpoint looks back over at most 20 positions from its own position. The longest live match wins, and reading refreshes it.
- **Limits.** Nothing under 1,024 tokens is cached, and an entry expires five minutes after its last use. The clock is injected, so a test can advance time and show an expiry.

Tokens are estimated at four characters per token. The simulator is not a tokenizer or a billing model: its only input is the bytes the harness put on the wire. `prompt-cache-simulator.test.ts` pins its rules on hand-built requests, one rule per test.

### Drive the real Session lifecycle

`prompt-cache-lifecycle.test.ts` runs a real `Session`, with Trace writing enabled, a real `Environment` where a scenario needs shell commands, and child Sessions for subagents. Every recorded request goes, in issue order, through one `PromptCacheSim`, because a provider does not keep a separate cache per Session. One assertion, `expectHits`, then holds every scenario to the same rule: each request after the first of its context reads back the whole prefix of that context's previous request.

A scenario that cannot meet the rule by design names the request and the reason, and bounds the loss with its own assertions:

```ts
const reason =
  "the context reopened and no breakpoint sits after the system prompt, so the fixed " +
  "prefix the new context resends is not addressable either";
expectHits(order, usages, new Map([[3, reason]]));
```

Two checks keep these exemptions honest. A request that opens a new context anywhere but at the start must be named, so a fresh cache line cannot appear unremarked. And an exemption has to earn its place: if the named request in fact reads back the whole prefix, the test fails and asks for the exemption to be removed, so a fix cannot leave a stale excuse behind.

### Three suites, and why their numbers are never edited to pass

| Suite | Tests | What it checks | What a failure means |
| --- | ---: | --- | --- |
| `prompt-cache-invariants.test.ts` | 8 | Each request extends the previous one on the wire (a real `ContextEngine`, read by the diagnostic) | A change made a request stop extending its predecessor. This is the regression itself. |
| `prompt-cache-lifecycle.test.ts` | 11 | Each request reads back its predecessor's prefix under the provider's rules (a real `Session`, read by the simulator) | The same regression, counted in provider tokens. |
| `prompt-cache-simulator.test.ts` | 14 | The simulator applies the documented rules (hand-built requests) | The rule engine changed. That is correct only when the provider's documentation changed. |

All 33 tests run with the rest of the core suite, need no network and no keys, and finish in under two seconds on our test machine. A failure prints a report. Here is what `expectHits` prints for one of the anti-patterns in Experiment 2, where a single word of the `exec_command` description is changed at request #4:

```text
#4 should read back all of #3
prompt-cache report (tokens; previous = the same context's previous request):
#0  main  read=0      creation=1972 input=0 hit=0.0%   first request of this context
#1  main  read=1972   creation=1556 input=0 hit=55.9%  full hit on #0
#2  main  read=3528   creation=1557 input=0 hit=69.4%  full hit on #1
#3  main  read=5085   creation=1556 input=0 hit=76.6%  full hit on #2
#4  main  read=0      creation=8199 input=0 hit=0.0%   short of #3 by 6641 tokens: tools_changed ("exec_command" definition changed)
#5  main  read=8199   creation=1556 input=0 hit=84.0%  full hit on #4
...
```

The most important rule is about people, not code: these numbers are never edited to make a test pass. Changing an expected number, or adding a request to the list of misses that exist by design, is a decision to spend users' money. The development guide in the repository says so in so many words: put the tier that moved and what it costs in front of whoever owns the decision, and let them decide. No other signal in the project would show a cache regression, so a test re-baselined to green means the regression ships.

## Experiments

### Setup

Every number below comes from the same machinery: a real `Session` over a real `GenerativeModel` with a scripted stream; each recorded request replayed through `PromptCacheSim` on a deterministic clock with 10 seconds between requests; and each divergence named by `diagnoseCacheMiss`. No model API was called. The scenarios were driven by a one-off script that uses only these helpers and the `Session` API; it is not part of the repository. The runs are deterministic: the same script on the same commit gives the same tables.

- The agent is the suites' fixture: model id `claude-sonnet-4-6` (a 1,024-token minimum), a system prompt of realistic length and two tools. Its fixed prefix (the model id, the tools, the system prompt and the two parameter blocks) is 1,673 tokens. The background-command and subagent scenarios run on a real `Environment` configured with stub tool definitions, a name and a one-line description each.
- Every tool call returns the same 5.8 KB of output, so one tool round (thinking, call and result) adds about 1,556 tokens.
- The replay lands the write of every recorded request, including one that dropped or was interrupted after its response began, in line with the documentation's rule that an entry is available once the response begins.
- **Hit ratio** is read ÷ (read + written + uncached), summed over all of a scenario's requests, the cold first request included. No prefix fell under the minimum, so uncached input is zero throughout and is not shown.
- **Input cost** is 0.1 × read + 1.25 × written + 1 × uncached, in units of the base input price (Anthropic's 5-minute rates). Output tokens are the same across the variants of a table and are left out.

These are simulator numbers under Anthropic's rules, not a live provider's.

### Experiment 1: the Session lifecycle

Requests are numbered from #0. "Falls short" names any request that read less than the whole prefix of its context's previous request, or, for a request that opens a context, less than its own whole prefix.

| Scenario | Requests | Read | Written | Hit ratio | Falls short | Why |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Multi-turn chat, 5 tasks | 5 | 7,000 | 1,850 | 79.1% | none | |
| Tool loop, 6 rounds | 7 | 33,474 | 11,027 | 75.2% | none | |
| Parallel tool calls, 2 rounds of 3 | 3 | 7,966 | 10,868 | 42.3% | none | |
| Steering mid-task | 5 | 16,142 | 7,940 | 67.0% | none | |
| Retry after a dropped stream | 4 | 8,220 | 4,845 | 62.9% | none | |
| Interrupted mid-task, then a new prompt | 4 | 9,736 | 4,847 | 66.8% | none | |
| Interrupted on a task's first request | 4 | 8,182 | 3,360 | 70.9% | #3 | the interrupted prompt is rewritten into `[turn_aborted]` |
| Background command and its completion notice | 3 | 3,122 | 1,730 | 64.3% | none | |
| Resumed from a Trace, 1 minute later | 4 | 9,730 | 4,834 | 66.8% | none | |
| Resumed from a Trace, 10 minutes later | 4 | 4,930 | 9,634 | 33.9% | #3 | the entry expired; the diagnostic finds no divergence |
| Thinking-level change | 5 | 9,792 | 8,100 | 54.7% | #2 | `parameters_changed [output_config]` |
| Compaction into a new context | 8 | 17,993 | 8,160 | 68.8% | #5 | a new context opens a new cache line |
| Subagent | 6 | 7,810 | 6,376 | 55.1% | #2 | the child Session opens its own cache line |
| Model switch | 7 | 13,168 | 6,603 | 66.6% | #4 | `model_changed`: a new model, a new cache line |

**A hit ratio under 100% is not a miss.** Each request writes what it appended, so the best a request can do is its predecessor's prefix divided by its own total. In the tool loop, the per-request ratio climbs from 52.0% on the second request to 85.9% on the seventh, while every request reads back all of the one before. In the chat, where a turn adds 40 tokens, it stays between 97.7% and 97.8%. The parallel calls score lowest for the same reason: each of their two requests appends three tool results.

**The diagnostic and the simulator disagree, usefully, on retries and interruptions.** For the retry and the mid-task interruption, the diagnostic reports `messages_changed`: the last user message gains a `[turn_retried]` or `[turn_aborted]` block. The simulator reports a full read because that block comes after the cached `tool_result`, everything up to that point is unchanged, and the dropped or interrupted request had already written its entry. A cached block is rewritten only when the interrupted turn's input carries text, such as the prompt on a task's first request, or a steering message or notice delivered with a tool round: that text is flattened into the `[turn_aborted]` block. The read then falls back to the request before; in the first-request scenario, that cost 36 tokens.

**Four requests read nothing on purpose.** The thinking-level change, the compaction, the subagent and the model switch each open a new cache line. After the thinking-level change and the compaction, the tools and the system prompt go out byte-identical here, and the simulator still reads nothing: with one breakpoint at the end of each request, no entry ever ends at the system prompt. In the product, the new context after a compaction assembles its prompt from disk again, so it stays identical only if nothing it draws on, such as `AGENTS.md`, the Memory index or the date, changed in between. The fixture's child Session also sends its parent's exact tools and system prompt; a real child does not, because it loses the subagent tools and its system prompt names its own Session ID. Experiment 3 measures what explicit breakpoints change.

**A resume is invisible to the provider, until the entry expires.** Resumed a minute later, the new process's first request reads back the whole replayed history, thinking signatures included. Resumed ten minutes later, the diagnostic finds no divergence and the read is zero. That is a lifetime problem, not a bytes problem.

### Experiment 2: anti-patterns, injected on purpose

We recorded one ten-request trace from a real Session (a six-round task, then a two-round follow-up, with six tool definitions) and replayed it unchanged as the baseline. Each variant rewrites the recorded requests the way a careless harness would, then goes through the same diagnostic and simulator. One-off changes strike at request #4.

| Variant | First diagnosis | Requests that diverge | Written | Hit ratio | Input cost |
| --- | --- | ---: | ---: | ---: | ---: |
| Baseline, as PenguinHarness sends it | none | 0 | 14,466 | 83.0% | 1.00× |
| Timestamp in the system prompt | `system_changed` | 9 | 85,327 | 0.0% | 4.24× |
| Tool order differs per request | `tools_changed` (names reordered) | 9 | 85,217 | 0.0% | 4.23× |
| One word of one tool description edited, once | `tools_changed` (`"exec_command" definition changed`) | 1 | 21,108 | 75.2% | 1.30× |
| One request routed to another model | `model_changed` | 2 | 22,663 | 73.4% | 1.37× |
| Fast mode switched on, once | `parameters_changed [betas, speed]` | 1 | 21,119 | 75.2% | 1.30× |
| `tool_choice` forced on each task's first request | `parameters_changed [tool_choice]` | 3 | 27,805 | 67.4% | 1.61× |
| Steering written into the task's first message, once | `messages_changed` at #0 | 1 | 19,153 | 77.6% | 1.21× |
| History rebuilt without thinking signatures, once | `messages_changed` at #1 | 1 | 19,087 | 77.5% | 1.21× |
| `max_tokens` changes per request (control) | none | 0 | 14,466 | 83.0% | 1.00× |

**Per-request anti-patterns bill the whole run as writes.** A timestamp in the system prompt or a shuffled tool list makes every request after the first miss. Over ten requests that is 4.2 times the baseline's input cost, and the factor grows as the history outgrows each turn's new tokens, toward the 12.5× gap between a write and a read.

**A one-off change costs one rewrite of everything after it, at the point where it lands.** The edited description cost 6,642 extra written tokens because it struck at request #4. The same edit at request 200 would re-bill the history at request 200. The model fallback costs two misses: one when the request goes to the other model, and one when the next request comes back. The return reads the entry written before the fallback, still within the lookback, so it loses only what came in between.

**Rewriting old history falls back to the newest entry before the edit.** Writing a steering message into the first message, or dropping thinking signatures when history is rebuilt, changes a block deep in the conversation. The read falls back to the newest entry within 20 positions ahead of the edit, here the first request's, and the diagnostic points at the exact message and block. Where a steering message goes matters less than whether it rewrites something already sent: delivered with the next tool results, as PenguinHarness does, it costs nothing (Experiment 1).

**The control does nothing.** `max_tokens` is not part of the prefix, so changing it on every request leaves every number unchanged.

### Experiment 3: where the breakpoints sit

MMSP sends one automatic breakpoint. Anthropic allows four, and the simulator can add two: after the last tool definition and after the system prompt. The table compares the two policies on the cases where they could differ. Input costs are relative to the same policy's baseline.

| Case | Automatic breakpoint only (today) | Plus breakpoints after tools and system prompt |
| --- | --- | --- |
| Thinking-level change: first request after it (3,275-token prefix) | reads 0 | reads 1,656 |
| Compaction: the new context's first request (1,710) | reads 0 | reads 1,656 |
| Subagent, fixture child with its parent's tools and prompt: first request (1,531) | reads 0 | reads 1,495 |
| Model switch: the new model's first request (1,709) | reads 0 | reads 0 |
| `tool_choice` forced per task, six tools: input cost | 1.61× | 1.43× |
| Timestamp in the system prompt, six tools (517-token tool tier): input cost | 4.24× | 4.24× |
| Timestamp in the system prompt, eighteen tools (2,269-token tool tier): input cost | 4.44× | 3.63× |
| Fast mode switched on once, eighteen tools: input cost | 1.33× | 1.24× |

Explicit breakpoints recover the tools and the system prompt at three of the four requests that open a new cache line: 1,495 to 1,656 tokens each time with this fixture. A model switch gains nothing, since the cache belongs to one model, and neither would a real subagent, whose tools and system prompt differ from its parent's.

A breakpoint helps only when the prefix before it clears the minimum. Six tool definitions plus the model id come to 517 tokens, so they are never cached on their own, and the timestamp row stays at 4.24×. With eighteen tools (2,269 tokens), the tools are read back on every request, and the cost falls to 3.63×. A thinking or `tool_choice` change still costs the messages under both policies, because those parameters sit after the system prompt's breakpoint.

## What the simulator cannot tell you

- **It is Anthropic-shaped.** The diagnostic is about bytes and applies to any provider. The simulator's numbers apply to another provider only to the extent that its rules resemble Anthropic's.
- **Token counts are estimates**, at four characters per token over each block's JSON. Ratios and comparisons are more reliable than absolute counts.
- **It reads the documentation literally, and on the optimistic side.** In the simulator, a thinking-parameter change keeps the tools and the system prompt; the documentation says that depends on the model. The simulator makes an entry readable when its request completes and dates its lifetime from then, while the documentation makes it available once the response begins and measures the lifetime from the start of the request. Those differences matter only for concurrent requests and for gaps near five minutes, and no scenario here sits there. The simulator also keeps every entry for its full lifetime; whether a live deployment does is a question only a live endpoint can answer.
- **It says nothing about live hit rates.** The Web App shows each conversation's actual cache hit rate from the provider's usage reports. The suites protect the part the harness controls.

## What comes next

PR #722 closed with recommendations that are still open:

- **Explicit breakpoints after the tools and the system prompt** in MMSP's Claude client. Experiment 3 measures what they recover.
- **An opt-in one-hour lifetime.** An agent waiting on an approval or a long background job can easily sit idle for more than five minutes, and each such gap costs the whole prefix, as the ten-minute resume shows.
- **A request fingerprint in the Trace** (hashes of the system prompt and tools, the thinking level, the history length), so the Web App can label a drop in the hit rate with a reason, the way the diagnostic does in tests.
- **Anthropic's cache diagnostics passed through**, with `cache_miss_reason` surfaced next to the usage it explains.

The three suites that hold the harness to these rules run with:

```bash
pnpm --filter @prismshadow/penguin-core exec vitest run \
  test/prompt-cache-invariants.test.ts \
  test/prompt-cache-lifecycle.test.ts \
  test/prompt-cache-simulator.test.ts
```

---

- **Read the code**: [the test helpers](https://github.com/Prism-Shadow/penguin-harness/tree/v0.2.16/packages/core/test/helpers/prompt-cache) · [`prompt-cache-lifecycle.test.ts`](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/prompt-cache-lifecycle.test.ts) · [The Agent Loop](https://penguin.ooo/docs/agent-loop)
- **Sources**: [Anthropic: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) · [Anthropic: Cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics) · [PR #700](https://github.com/Prism-Shadow/penguin-harness/pull/700) · [PR #722](https://github.com/Prism-Shadow/penguin-harness/pull/722)
