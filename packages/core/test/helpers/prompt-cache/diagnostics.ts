/**
 * The diagnostic: where two consecutive requests stopped being one growing prefix.
 *
 * A provider serves a cached prefix only when the next request repeats the previous one byte for
 * byte from the front — tools, then the system prompt, then the messages. `diagnoseCacheMiss`
 * takes two requests that `recording.ts` captured and names the earliest level at which that
 * stops holding, in the vocabulary and the precedence order of the `cache_miss_reason` Anthropic
 * reports: model, system, tools, the remaining prompt-affecting parameters, then the messages.
 *
 * This is the harness's half of prompt caching, and it is a statement about bytes only. Whether a
 * prefix that could hit actually did — lifetime, breakpoint lookback, minimum cacheable size — is
 * `simulator.ts`, which calls back into this file to name the divergence behind a modelled miss.
 */
import type { RecordedRequest } from "./recording.js";

/** Rough characters-per-token ratio, only used to size the input a divergence invalidates. */
const CHARS_PER_TOKEN = 4;
/** Request config keys that do not take part in the cached prefix. */
const NON_PREFIX_CONFIG_KEYS = ["max_tokens", "stream"];

/** The earliest divergence between two consecutive requests, in provider precedence order. */
export type CacheMissReason =
  | { type: "none" }
  | { type: "model_changed" }
  | { type: "system_changed" }
  | { type: "tools_changed"; detail: string }
  /** thinking / output_config / tool_choice / speed / betas / cache_control — everything
   * prompt-affecting except max_tokens. */
  | { type: "parameters_changed"; keys: string[] }
  | {
      type: "messages_changed";
      index: number;
      detail: string;
      cache_missed_input_estimate: number;
    };

const json = (value: unknown): string => JSON.stringify(value ?? null);

// ---- Diagnosing -----------------------------------------------------------

/**
 * The earliest level at which `next` stops being an extension of `prev`, in the order a
 * provider invalidates them: model, system, tools, the remaining prompt-affecting parameters,
 * then the messages. `max_tokens` is excluded — it does not take part in the cached prefix.
 */
export function diagnoseCacheMiss(prev: RecordedRequest, next: RecordedRequest): CacheMissReason {
  const before = prefixConfig(prev.wireConfig);
  const after = prefixConfig(next.wireConfig);
  if (json(before.model) !== json(after.model)) return { type: "model_changed" };
  if (json(before.system) !== json(after.system)) return { type: "system_changed" };
  if (json(before.tools) !== json(after.tools)) {
    return { type: "tools_changed", detail: describeToolChange(before.tools, after.tools) };
  }
  const keys = changedKeys(before, after, ["model", "system", "tools"]);
  if (keys.length > 0) return { type: "parameters_changed", keys };
  return diagnoseMessages(prev.wire, next.wire);
}

/** `diagnoseCacheMiss` over each consecutive pair: entry i describes request i -> i+1. */
export function diagnoseSeries(requests: RecordedRequest[]): CacheMissReason[] {
  const reasons: CacheMissReason[] = [];
  for (let i = 1; i < requests.length; i += 1) {
    reasons.push(diagnoseCacheMiss(requests[i - 1]!, requests[i]!));
  }
  return reasons;
}

/** The config keys that take part in the cached prefix. */
function prefixConfig(wireConfig: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...wireConfig };
  for (const key of NON_PREFIX_CONFIG_KEYS) delete copy[key];
  return copy;
}

function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  skip: string[],
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of skip) keys.delete(key);
  return [...keys].filter((key) => json(before[key]) !== json(after[key])).sort();
}

function describeToolChange(before: unknown, after: unknown): string {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const names = (list: unknown[]): string[] =>
    list.map((tool) => String((tool as { name?: unknown }).name ?? "?"));
  const prevNames = names(prev);
  const nextNames = names(next);
  if (json(prevNames) !== json(nextNames)) {
    return `names [${prevNames.join(", ")}] -> [${nextNames.join(", ")}]`;
  }
  for (let i = 0; i < prev.length; i += 1) {
    if (json(prev[i]) !== json(next[i])) return `"${prevNames[i]}" definition changed`;
  }
  return "tool list changed";
}

function diagnoseMessages(prev: unknown[], next: unknown[]): CacheMissReason {
  for (let i = 0; i < prev.length; i += 1) {
    if (i >= next.length) {
      return {
        type: "messages_changed",
        index: i,
        detail: `history shrank from ${prev.length} to ${next.length} messages`,
        cache_missed_input_estimate: missedInput(next, i),
      };
    }
    if (json(prev[i]) !== json(next[i])) {
      return {
        type: "messages_changed",
        index: i,
        detail: describeMessageChange(i, prev[i], next[i]),
        cache_missed_input_estimate: missedInput(next, i),
      };
    }
  }
  return { type: "none" };
}

/** Roughly how much input sits after the divergence, and so has to be read again. */
function missedInput(next: unknown[], index: number): number {
  return Math.ceil(JSON.stringify(next.slice(index)).length / CHARS_PER_TOKEN);
}

function describeMessageChange(index: number, prev: unknown, next: unknown): string {
  const prevBlocks = blocksOf(prev);
  const nextBlocks = blocksOf(next);
  const prevRole = roleOf(prev);
  const nextRole = roleOf(next);
  const role = prevRole === nextRole ? prevRole : `${prevRole} -> ${nextRole}`;
  const count = Math.max(prevBlocks.length, nextBlocks.length);
  let at = count;
  for (let i = 0; i < count; i += 1) {
    if (json(prevBlocks[i]) !== json(nextBlocks[i])) {
      at = i;
      break;
    }
  }
  return `${role} message #${index}, block ${at}: ${blockType(prevBlocks[at])} -> ${blockType(
    nextBlocks[at],
  )}`;
}

const roleOf = (message: unknown): string =>
  String((message as { role?: unknown } | undefined)?.role ?? "?");

function blocksOf(message: unknown): unknown[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (Array.isArray(content)) return content;
  return content === undefined ? [] : [content];
}

const blockType = (block: unknown): string =>
  block === undefined ? "absent" : String((block as { type?: unknown }).type ?? "?");

// ---- Reporting ------------------------------------------------------------

/** A compact per-request table, for the message of a failing assertion. */
export function formatDiagnostics(requests: RecordedRequest[], reasons: CacheMissReason[]): string {
  const rows = requests.map((request, i) => [
    `#${request.index}`,
    `messages=${request.wire.length}`,
    thinkingLabel(request.wireConfig),
    i === 0 ? "(first request)" : describeMissReason(reasons[i - 1]),
  ]);
  const widths = [0, 1, 2].map((col) => Math.max(...rows.map((row) => row[col]!.length)));
  const lines = rows.map((row) =>
    row.map((cell, col) => (col < 3 ? cell.padEnd(widths[col]!) : cell)).join("  "),
  );
  return ["prompt-cache diagnostics:", ...lines].join("\n");
}

function thinkingLabel(wireConfig: Record<string, unknown>): string {
  const thinking = wireConfig.thinking as { type?: string; display?: string } | undefined;
  const effort = (wireConfig.output_config as { effort?: string } | undefined)?.effort;
  const mode = thinking ? `${thinking.type ?? "?"}/${thinking.display ?? "?"}` : "off";
  return `thinking=${mode} effort=${effort ?? "-"}`;
}

/** One cache-miss reason as a single line, in the vocabulary a provider's diagnostics use. */
export function describeMissReason(reason: CacheMissReason | undefined): string {
  if (!reason) return "?";
  if (reason.type === "tools_changed") return `tools_changed (${reason.detail})`;
  if (reason.type === "parameters_changed") {
    return `parameters_changed [${reason.keys.join(", ")}]`;
  }
  if (reason.type === "messages_changed") {
    return (
      `messages_changed at #${reason.index} (${reason.detail}), ` +
      `~${reason.cache_missed_input_estimate} input tokens after the divergence`
    );
  }
  return reason.type;
}
