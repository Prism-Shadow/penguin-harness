/**
 * The simulator: an Anthropic-shaped prompt cache, run over recorded requests.
 *
 * `diagnostics.ts` measures the harness's half — whether each request is a pure extension of the
 * one before it. This file models the provider's half, the part that decides whether a prefix
 * that *could* hit actually does, so a test can state a scenario's result in the numbers the
 * provider reports: `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`. Its
 * only input is what `recording.ts` captured, and it calls back into `diagnostics.ts` to name the
 * divergence behind a miss. `fixtures.ts` wraps it in the assertion the Session suites share.
 *
 * The rules modelled, from Anthropic's prompt-caching documentation:
 *
 *   - **Blocks.** A request is one ordered block list: the model id, a block per tool
 *     definition, one virtual "speed" block holding the fast-mode parameters (`speed`,
 *     `betas`), one system block, one virtual "parameters" block holding the remaining
 *     prompt-affecting request parameters (`thinking`, `output_config`, `tool_choice`), then
 *     every content block of every message in order. `max_tokens`, `stream` and `cache_control`
 *     take part in none of it. That order is what reproduces the documented invalidation
 *     hierarchy: a model switch invalidates everything — the cache is scoped to one model, and
 *     no breakpoint can be placed in front of the model id — a tool change everything behind
 *     the tools, a fast-mode toggle the system prompt and the messages but not the tools, a
 *     system change the messages, and a thinking/effort or `tool_choice` change the messages
 *     alone. That last row is the optimistic case: the documentation marks it model-specific,
 *     and a model that renders the thinking configuration ahead of the tools and the system
 *     prompt invalidates those tiers too.
 *   - **Positions.** A run of consecutive `tool_use` blocks counts as one position, and so does
 *     a run of consecutive `tool_result` blocks; every other block is a position of its own.
 *   - **Writes happen only at a breakpoint.** A completed request writes one entry per
 *     breakpoint it carries: the hash of the prefix ending at that block. Content sitting
 *     behind a breakpoint is not separately addressable — a read finds entries prior requests
 *     wrote, never a stable prefix nobody ever closed. AgentHub's Claude client sets exactly
 *     one breakpoint, the automatic one at the last block (a top-level
 *     `cache_control: ephemeral`), which is what `breakpoints: "automatic"` models and the
 *     default. `breakpoints: "tools-system-automatic"` models the alternative Anthropic allows
 *     (four breakpoints in all): explicit ones on the last tool block and on the system block,
 *     plus the automatic one. That second policy is not what the harness sends today; it is
 *     here so a test can measure what the extra breakpoints would recover.
 *   - **Reads.** Every breakpoint the request carries does its own lookback: it hashes the
 *     prefix ending at that breakpoint and, failing an exact match, walks back one position at
 *     a time over at most {@link DEFAULT_LOOKBACK_POSITIONS} positions of its own — never from
 *     the request's last position. The longest live match across the breakpoints is what the
 *     request reads, and reading refreshes that entry.
 *   - **TTL.** An entry expires {@link DEFAULT_TTL_MS} after it was last written or read; a
 *     read refreshes it. The clock is injected, so a test can advance it and show an expiry.
 *
 * What it is not: a token counter (blocks are estimated at four characters per token, the ratio
 * the harness's own estimator uses for ASCII), a billing model, or a promise about any
 * particular provider deployment. It is a rule engine whose only inputs are the bytes the
 * harness put on the wire.
 */
import { createHash } from "node:crypto";
import { diagnoseCacheMiss, describeMissReason } from "./diagnostics.js";
import type { RecordedRequest } from "./recording.js";

/** Smallest prefix a provider will cache, in tokens. */
export const DEFAULT_MIN_CACHEABLE_TOKENS = 1024;
/** Lifetime of an ephemeral cache entry (five minutes, AgentHub's default). */
export const DEFAULT_TTL_MS = 5 * 60 * 1000;
/**
 * Positions checked per breakpoint. The documented wording is "up to 20 positions before the
 * breakpoint", which leaves the breakpoint's own position ambiguous; what is encoded here is the
 * conservative reading — the breakpoint counts as the first of the twenty, so nineteen appended
 * positions still reach the previous write and twenty do not. Nothing measured in these suites
 * sits near that boundary, so the off-by-one is a statement about the rule's precision rather
 * than about any scenario's result.
 */
const DEFAULT_LOOKBACK_POSITIONS = 20;
/** Characters per token, the ratio the harness's own estimator uses for ASCII. */
const CHARS_PER_TOKEN = 4;

/**
 * Prompt-affecting parameters rendered *ahead* of the system block, so that changing one keeps
 * the tool definitions and loses everything behind them. AgentHub sets exactly this pair for
 * fast mode.
 */
const SPEED_KEYS = ["speed", "betas"] as const;

/**
 * Prompt-affecting parameters rendered *after* the system block, in the order the virtual
 * parameters block renders them, so that changing one keeps the tools and the system prompt.
 * `max_tokens` is deliberately absent: it varies per request (the window-derived clamp) and is
 * not part of the cache key. So are `stream` and `cache_control`, which describe the transport
 * and the breakpoint rather than the prompt.
 */
const PARAMETER_KEYS = ["thinking", "output_config", "tool_choice"] as const;

/** What a block came from — the sections of the prefix, in the order they are sent. */
type CacheBlockKind = "model" | "tool" | "speed" | "system" | "parameters" | "message";

/** The blocks a breakpoint on the last tool block closes. */
const TOOL_TIER: CacheBlockKind[] = ["model", "tool"];
/** The blocks a breakpoint on the system block closes. */
const SYSTEM_TIER: CacheBlockKind[] = ["model", "tool", "speed", "system"];

/** One block of the prefix: the unit a hash, a token count and a position are taken over. */
interface CacheBlock {
  kind: CacheBlockKind;
  /** The block's canonical rendering: what both the hash and the token estimate are taken over. */
  text: string;
  /** Wire block type (`text` / `thinking` / `tool_use` / `tool_result`); message blocks only. */
  blockType?: string;
  /** Index of the wire message this block came from; message blocks only. */
  message?: number;
  tokens: number;
}

/** One request's usage, as Anthropic reports it, plus what it took to get there. */
export interface CacheUsage {
  /** Tokens served from the cache (the matched prefix). */
  cache_read_input_tokens: number;
  /** Tokens written to the cache (from the match point to the breakpoint). */
  cache_creation_input_tokens: number;
  /** Tokens processed without being cached (the remainder when no write happened). */
  input_tokens: number;
  /** `read / (read + creation + input)`; 0 for an empty prefix. */
  hitRatio: number;
  /** How many blocks of this request's prefix the read covered. */
  matchedBlocks: number;
  /** How many blocks this request's prefix holds. */
  totalBlocks: number;
  /** Whether this request's prefix was cached (false below the minimum). */
  wrote: boolean;
}

/**
 * Where a request's cache breakpoints sit. `"automatic"` is what AgentHub's Claude client
 * sends: one breakpoint, at the last block. `"tools-system-automatic"` adds the two explicit
 * breakpoints the API allows alongside it — on the last tool block and on the system block — so
 * a request whose messages moved can still read the fixed prefix back.
 */
type BreakpointPolicy = "automatic" | "tools-system-automatic";

interface PromptCacheSimOptions {
  /** Smallest cacheable prefix, in tokens (default {@link DEFAULT_MIN_CACHEABLE_TOKENS}). */
  minCacheableTokens?: number;
  /** Where the breakpoints sit (default `"automatic"`, what the harness sends today). */
  breakpoints?: BreakpointPolicy;
  /** The clock; injected so a test can advance it (default `Date.now`). */
  now?: () => number;
}

const json = (value: unknown): string => JSON.stringify(value ?? null);

const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

const roleOf = (message: unknown): string =>
  String((message as { role?: unknown } | undefined)?.role ?? "?");

function contentBlocksOf(message: unknown): unknown[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (Array.isArray(content)) return content;
  return content === undefined ? [] : [content];
}

const blockTypeOf = (block: unknown): string | undefined => {
  const type = (block as { type?: unknown } | undefined)?.type;
  return typeof type === "string" ? type : undefined;
};

// ---- Reading a request as blocks and positions ----------------------------

/** The named request parameters, in a fixed order, absent keys omitted. */
function parameterView(
  wireConfig: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const key of keys) {
    if (wireConfig[key] !== undefined) view[key] = wireConfig[key];
  }
  return view;
}

function makeBlock(
  kind: CacheBlockKind,
  text: string,
  extra: Partial<CacheBlock> = {},
): CacheBlock {
  return { kind, text, tokens: estimateTokens(text), ...extra };
}

/**
 * One request as the ordered block list the cache keys on: the model, the tools, the fast-mode
 * parameters, the system prompt, the remaining parameters, then every content block of every
 * message, each rendered with its message's role so an identical block under a different role
 * is a different block.
 */
function prefixBlocks(request: RecordedRequest): CacheBlock[] {
  const wireConfig = request.wireConfig;
  const blocks: CacheBlock[] = [];
  // Ahead of the tools: a prompt cache is scoped to one model, and a model switch is the one
  // invalidator no breakpoint can be placed in front of.
  blocks.push(makeBlock("model", `model:${json(wireConfig.model)}`));
  const tools = Array.isArray(wireConfig.tools) ? wireConfig.tools : [];
  for (const tool of tools) blocks.push(makeBlock("tool", `tool:${json(tool)}`));
  blocks.push(makeBlock("speed", `speed:${json(parameterView(wireConfig, SPEED_KEYS))}`));
  blocks.push(makeBlock("system", `system:${json(wireConfig.system)}`));
  blocks.push(
    makeBlock("parameters", `parameters:${json(parameterView(wireConfig, PARAMETER_KEYS))}`),
  );
  request.wire.forEach((message, index) => {
    const role = roleOf(message);
    for (const block of contentBlocksOf(message)) {
      const type = blockTypeOf(block);
      blocks.push(
        makeBlock("message", `message:${role}:${json(block)}`, {
          message: index,
          ...(type !== undefined ? { blockType: type } : {}),
        }),
      );
    }
  });
  return blocks;
}

/** Blocks that merge into their neighbour when consecutive (tool calls, tool results). */
const runKindOf = (block: CacheBlock): string | null =>
  block.blockType === "tool_use" || block.blockType === "tool_result" ? block.blockType : null;

/**
 * The end offsets (block counts) of every position, ascending; the last one is the automatic
 * breakpoint. A maximal run of consecutive `tool_use` or `tool_result` blocks contributes a
 * single offset, which is why a turn that calls twenty-five tools stays one position away from
 * the last one.
 */
function positionEnds(blocks: CacheBlock[]): number[] {
  const ends: number[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const kind = runKindOf(blocks[i]!);
    const next = blocks[i + 1];
    if (kind !== null && next !== undefined && runKindOf(next) === kind) continue;
    ends.push(i + 1);
  }
  return ends;
}

/** How many positions a request's prefix holds. */
export const positionCount = (request: RecordedRequest): number =>
  positionEnds(prefixBlocks(request)).length;

// ---- Token counts a test states its bounds in -----------------------------

const sumTokens = (blocks: CacheBlock[]): number =>
  blocks.reduce((total, block) => total + block.tokens, 0);

const tierTokens = (request: RecordedRequest, kinds: CacheBlockKind[]): number =>
  sumTokens(prefixBlocks(request).filter((block) => kinds.includes(block.kind)));

/** Every token of a request's prefix — what a full hit would read. */
export const prefixTokens = (request: RecordedRequest): number => sumTokens(prefixBlocks(request));

/** The model id and the tool definitions — what a breakpoint on the last tool block closes. */
export const toolsTokens = (request: RecordedRequest): number => tierTokens(request, TOOL_TIER);

/** Everything through the system prompt — what a breakpoint on the system block closes. */
export const toolsAndSystemTokens = (request: RecordedRequest): number =>
  tierTokens(request, SYSTEM_TIER);

/** Every non-message block — the fixed prefix a fresh context reopens on. */
export const fixedPrefixTokens = (request: RecordedRequest): number =>
  sumTokens(prefixBlocks(request).filter((block) => block.kind !== "message"));

/**
 * Everything ahead of the request's last user message: the bound a divergence confined to that
 * message (an interruption's carry-over, a reconnect's retried input) may not cross.
 */
export function tokensBeforeLastUserMessage(request: RecordedRequest): number {
  const last = request.wire.map(roleOf).lastIndexOf("user");
  if (last < 0) return prefixTokens(request);
  return sumTokens(
    prefixBlocks(request).filter((block) => block.message === undefined || block.message < last),
  );
}

// ---- The cache ------------------------------------------------------------

interface PendingWrite {
  /** Cumulative prefix hashes, index `k` covering the first `k` blocks. */
  hashes: string[];
  /** Cumulative token sums, index `k` covering the first `k` blocks. */
  sums: number[];
  /** Prefix lengths this request's breakpoints close, in blocks. */
  offsets: number[];
}

/**
 * The provider's cache, as a rule engine over recorded requests. One instance is one provider
 * for one test: every request of the scenario — a subagent's child session included — goes
 * through the same one, because a provider does not keep a cache per Session.
 */
export class PromptCacheSim {
  private readonly minCacheableTokens: number;
  private readonly breakpoints: BreakpointPolicy;
  private readonly now: () => number;
  /** Live entries: cumulative prefix hash -> expiry timestamp. */
  private readonly entries = new Map<string, number>();
  /** Writes staged by `begin`, readable only once `complete` lands them. */
  private readonly pending = new Map<RecordedRequest, PendingWrite>();

  constructor(options: PromptCacheSimOptions = {}) {
    this.minCacheableTokens = options.minCacheableTokens ?? DEFAULT_MIN_CACHEABLE_TOKENS;
    this.breakpoints = options.breakpoints ?? "automatic";
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * The read side of one request: what it serves from the cache, and what it will write. The
   * write is staged, not landed — an entry becomes readable only when the request completes,
   * so a second request issued while this one is still streaming cannot read it.
   */
  begin(request: RecordedRequest): CacheUsage {
    const blocks = prefixBlocks(request);
    const ends = positionEnds(blocks);
    const hashes = cumulativeHashes(blocks);
    const sums = cumulativeTokens(blocks);
    const total = sums[blocks.length]!;
    const offsets = this.breakpointOffsets(blocks);

    const matchedBlocks = this.lookup(hashes, ends, offsets);
    const read = sums[matchedBlocks]!;
    const wrote = total >= this.minCacheableTokens;
    this.pending.set(request, { hashes, sums, offsets });

    const remainder = total - read;
    const creation = wrote ? remainder : 0;
    const input = wrote ? 0 : remainder;
    const accounted = read + creation + input;
    return {
      cache_read_input_tokens: read,
      cache_creation_input_tokens: creation,
      input_tokens: input,
      hitRatio: accounted === 0 ? 0 : read / accounted,
      matchedBlocks,
      totalBlocks: blocks.length,
      wrote,
    };
  }

  /** Lands the writes `begin` staged: from here on this request's breakpoints are readable. */
  complete(request: RecordedRequest): void {
    const staged = this.pending.get(request);
    if (!staged) throw new Error("PromptCacheSim.complete: the request was never begun");
    this.pending.delete(request);
    const expiry = this.now() + DEFAULT_TTL_MS;
    for (const offset of staged.offsets) {
      if (staged.sums[offset]! < this.minCacheableTokens) continue;
      this.entries.set(staged.hashes[offset]!, expiry);
    }
  }

  /** `begin` then `complete`: one request that ran to its end before the next one started. */
  request(request: RecordedRequest): CacheUsage {
    const usage = this.begin(request);
    this.complete(request);
    return usage;
  }

  /**
   * Prefix lengths this request's breakpoints close: the automatic one at the last block
   * always, and under the wider policy the last tool block and the system block as well (both
   * are positions of their own, so both are addressable boundaries).
   */
  private breakpointOffsets(blocks: CacheBlock[]): number[] {
    const offsets = [blocks.length];
    if (this.breakpoints !== "tools-system-automatic") return offsets;
    const lastTool = blocks.findLastIndex((block) => block.kind === "tool");
    const system = blocks.findIndex((block) => block.kind === "system");
    if (lastTool >= 0) offsets.push(lastTool + 1);
    if (system >= 0) offsets.push(system + 1);
    return offsets;
  }

  /**
   * The longest live prefix this request can read, as a block count. Every breakpoint gets its
   * own lookback window, anchored at its own position rather than at the request's last one, so
   * an explicit breakpoint on the system block still reads at distance zero however many message
   * positions follow it. Reading refreshes the entry that won.
   */
  private lookup(hashes: string[], ends: number[], offsets: number[]): number {
    const now = this.now();
    let best = 0;
    for (const offset of offsets) {
      const anchor = ends.indexOf(offset);
      if (anchor < 0) continue;
      const first = Math.max(0, anchor + 1 - DEFAULT_LOOKBACK_POSITIONS);
      for (let i = anchor; i >= first; i -= 1) {
        const end = ends[i]!;
        // Positions descend, so nothing left in this window can beat what another already won.
        if (end <= best) break;
        const expiry = this.entries.get(hashes[end]!);
        if (expiry === undefined) continue;
        if (expiry <= now) {
          this.entries.delete(hashes[end]!);
          continue;
        }
        best = end;
        break;
      }
    }
    if (best > 0) this.entries.set(hashes[best]!, now + DEFAULT_TTL_MS);
    return best;
  }
}

/** Cumulative prefix hashes: index `k` covers the first `k` blocks (index 0 the empty prefix). */
function cumulativeHashes(blocks: CacheBlock[]): string[] {
  const hashes: string[] = [createHash("sha256").update("").digest("hex")];
  for (const block of blocks) {
    const previous = hashes[hashes.length - 1]!;
    hashes.push(createHash("sha256").update(`${previous} ${block.text}`).digest("hex"));
  }
  return hashes;
}

/** Cumulative token sums: index `k` covers the first `k` blocks. */
function cumulativeTokens(blocks: CacheBlock[]): number[] {
  const sums = [0];
  for (const block of blocks) sums.push(sums[sums.length - 1]! + block.tokens);
  return sums;
}

// ---- Reporting ------------------------------------------------------------

/**
 * Why the prefix moved between two requests, in the vocabulary a provider's cache diagnostics
 * use. Reuses the request-assembly diagnosis: a miss the simulator reports is either a
 * divergence this names, or none at all — an expiry, a lookback overrun, a reopened context.
 */
export function explainMiss(prev: RecordedRequest, next: RecordedRequest): string {
  const reason = diagnoseCacheMiss(prev, next);
  return reason.type === "none" ? "no divergence" : describeMissReason(reason);
}

/** The request before `index` issued by the same context, or -1 when there is none. */
export function previousInContext(requests: RecordedRequest[], index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (requests[i]!.label === requests[index]!.label) return i;
  }
  return -1;
}

/**
 * A per-request table for a failing assertion's message: what each request read, created and
 * paid for in full, and — when the read fell short of the previous request's whole prefix —
 * why. Requests are in issue order; "previous" means the previous request of the same context.
 */
export function formatCacheReport(requests: RecordedRequest[], usages: CacheUsage[]): string {
  const rows = requests.map((request, i) => {
    const usage = usages[i];
    if (!usage) return [`#${i}`, request.label ?? "-", "(no usage recorded)", "", ""];
    const previous = previousInContext(requests, i);
    const percent = `${(usage.hitRatio * 100).toFixed(1)}%`;
    let note: string;
    if (previous < 0) {
      note = "first request of this context";
    } else {
      const expected = prefixTokens(requests[previous]!);
      note =
        usage.cache_read_input_tokens >= expected
          ? `full hit on #${previous}`
          : `short of #${previous} by ${expected - usage.cache_read_input_tokens} tokens: ` +
            explainMiss(requests[previous]!, request);
    }
    return [
      `#${i}`,
      request.label ?? "-",
      `read=${usage.cache_read_input_tokens}`,
      `creation=${usage.cache_creation_input_tokens} input=${usage.input_tokens} hit=${percent}`,
      note,
    ];
  });
  const widths = [0, 1, 2, 3].map((column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  const lines = rows.map((row) =>
    row.map((cell, column) => (column < 4 ? cell.padEnd(widths[column]!) : cell)).join("  "),
  );
  const heading = "prompt-cache report (tokens; previous = the same context's previous request):";
  return [heading, ...lines].join("\n");
}
