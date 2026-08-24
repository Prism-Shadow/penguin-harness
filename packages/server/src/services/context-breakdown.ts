/**
 * Context composition: what the Session's current model context is made of, split into the six
 * parts a reader can act on — system prompt, tool definitions, user messages, model messages,
 * tool requests, tool results — plus the tools whose call traffic occupies the most of it.
 *
 * The basis is **one Trace shard**. A shard is one complete model context by construction: the
 * writer rotates on compaction and opens the new file with `session_meta` followed by
 * `tool_list_ready`, and Session resumption keeps appending to the shard it left off in. So a
 * Session's newest shard holds exactly the messages the model still sees. The one exception is
 * a shard whose last record is a completed `compaction_end`: that context is closed and the
 * next one has not been written yet (rotation is deferred until the first write after the
 * compaction), so the composition describes what was compacted away rather than what the model
 * now carries. `contextClosed` reports it; the rule is the same one Trace replay applies to
 * decide it must replay nothing.
 *
 * Sizes come from the character heuristic core already applies to request inputs
 * (`approximateMessagesTokens`: ASCII at ~4 characters per token, wide characters at 1, a flat
 * allowance per image), not from a tokenizer — this project ships none, and occupancy itself is
 * read off the provider's `token_usage`. Every figure here is therefore an estimate; what it is
 * good for is **shares**, which is what its consumers spend it on.
 */
import {
  DEFAULT_MAX_CONTEXT_LENGTH,
  approximateMessagesTokens,
  approximateTokens,
  effectiveMaxContextLength,
} from "@prismshadow/penguin-core";
import type {
  OmniMessage,
  SessionMetaPayload,
  ToolCallOutputPayload,
  ToolCallPayload,
  ToolListReadyPayload,
} from "@prismshadow/penguin-core";
import type { SessionContextParts } from "../api/types.js";

/** How many tools the ranking names before the tail is dropped. */
const TOP_TOOLS = 5;

/** The answer for a Session with no Trace yet: measured as empty, not unknown. */
export function emptyContextBreakdown(): SessionContextParts {
  return {
    systemPrompt: 0,
    toolDefs: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolRequests: 0,
    toolResults: 0,
    total: 0,
    topTools: [],
    contextClosed: false,
  };
}

function bump(per: Map<string, number>, name: string, tokens: number): void {
  per.set(name, (per.get(name) ?? 0) + tokens);
}

/**
 * True when this shard's context was closed by a completed compaction — the same test Trace
 * replay uses: the file's last record is a `compaction_end` reporting `completed`. Anything
 * written after a compaction lands in the next shard, so no later record can follow it here.
 */
function endsWithCompletedCompaction(messages: OmniMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (last === undefined || last.type !== "event_msg") return false;
  const p = last.payload as { type?: string; status?: string };
  return p.type === "compaction_end" && p.status === "completed";
}

/** Composition of the context held by one Trace shard's messages (in write order). */
export function buildContextBreakdown(messages: OmniMessage[]): SessionContextParts {
  const out = emptyContextBreakdown();
  /** name -> its calls plus their results; the definition is the `toolDefs` part, not a tool's own share. */
  const perTool = new Map<string, number>();
  /** tool_call_id -> tool name, so a result can be attributed to the tool that produced it. */
  const callName = new Map<string, string>();
  let compacting = false;

  for (const msg of messages) {
    if (msg.type === "session_meta") {
      // A per-shard invariant, not an accumulation: a resumed process writes its own copy into
      // the shard it continues, and a rotation writes one at the head of the new file. The
      // newest wins; adding them would count one system prompt several times.
      out.systemPrompt = approximateTokens((msg.payload as SessionMetaPayload).system_prompt ?? "");
      continue;
    }
    const p = msg.payload as { type?: string; role?: string };
    if (msg.type === "event_msg") {
      // Events are observability records — none of them is sent to the model — so the only ones
      // that matter here are the toolset record and the compaction span's boundaries.
      if (p.type === "tool_list_ready") {
        // Same "newest wins" reasoning as session_meta: this record rides the first run of each
        // process and each rotation, and it always carries the whole toolset.
        const tools = (p as unknown as ToolListReadyPayload).tools ?? [];
        out.toolDefs = tools.reduce((n, t) => n + approximateTokens(JSON.stringify(t)), 0);
      } else if (p.type === "compaction_begin") {
        compacting = true;
      } else if (p.type === "compaction_end") {
        compacting = false;
      }
      continue;
    }
    // A compaction is an LLM Request of its own, recorded inside this shard: its prompt and the
    // summary it produces were never part of the context being described.
    if (compacting) continue;

    const size = approximateMessagesTokens([msg]);
    switch (p.type) {
      case "text":
      case "image_url":
      case "inline_data":
        if (p.role === "assistant") out.assistantMessages += size;
        else out.userMessages += size;
        break;
      case "thinking":
      case "inline_thinking":
        out.assistantMessages += size;
        break;
      case "tool_call": {
        const tc = p as unknown as ToolCallPayload;
        out.toolRequests += size;
        callName.set(tc.tool_call_id, tc.name);
        bump(perTool, tc.name, size);
        break;
      }
      case "tool_call_output": {
        const result = p as unknown as ToolCallOutputPayload;
        out.toolResults += size;
        // An output whose call is not in this shard still counts toward the tool-results part;
        // it just has no tool to be attributed to, so the ranking can sum to less than
        // `toolRequests + toolResults`.
        const name = callName.get(result.tool_call_id);
        if (name !== undefined) bump(perTool, name, size);
        break;
      }
    }
  }

  out.total =
    out.systemPrompt +
    out.toolDefs +
    out.userMessages +
    out.assistantMessages +
    out.toolRequests +
    out.toolResults;
  out.topTools = [...perTool]
    // Name breaks ties so equal-sized tools keep a stable order across calls.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_TOOLS)
    .map(([name, tokens]) => ({ name, tokens }));
  out.contextClosed = endsWithCompletedCompaction(messages);
  return out;
}

/**
 * Where compaction will fire for a Session, in tokens of occupancy — the Agent's configured
 * `compaction.max_context_length` (its seeded default when unset) capped by what the model's
 * context window leaves room for, which is the same derivation the Agent applies when it builds a
 * Session's compaction settings.
 *
 * Null means "nothing to mark on a gauge that runs to the window": compaction switched off
 * (`<= 0`), or a threshold at or past the window itself — which is what an implausibly small
 * `context_window` produces, since the derivation then reasons from the assumed default window
 * instead of the configured one.
 */
export function compactionThresholdFor(
  configured: number | undefined,
  contextWindow: number | undefined,
): number | null {
  const threshold = effectiveMaxContextLength(
    configured ?? DEFAULT_MAX_CONTEXT_LENGTH,
    contextWindow,
  );
  if (threshold <= 0) return null;
  return contextWindow !== undefined && threshold >= contextWindow ? null : threshold;
}
