/**
 * The simulator's own rules, on hand-built requests.
 *
 * `prompt-cache-lifecycle.test.ts` reads every scenario's result off this simulator, so the rules
 * it applies are pinned here first: what counts as a block, what counts as a position, which
 * change loses what, and the three limits a provider imposes on top of the hashes — the minimum
 * cacheable prefix, the entry lifetime, and the lookback window.
 *
 * The requests below are written by hand rather than recorded (`helpers/prompt-cache/recording.ts`
 * is what records them elsewhere), so each case is a statement about one rule and nothing else.
 */
import { describe, expect, it } from "vitest";
import type { UniConfig } from "@prismshadow/agenthub";
import {
  DEFAULT_TTL_MS,
  PromptCacheSim,
  fixedPrefixTokens,
  positionCount,
  prefixTokens,
  toolsAndSystemTokens,
  toolsTokens,
} from "./helpers/prompt-cache/index.js";
import type { RecordedRequest } from "./helpers/prompt-cache/index.js";

// ---------------------------------------------------------------------------
// A tiny RecordedRequest factory: the wire shape only, nothing the engine produces
// ---------------------------------------------------------------------------

interface WireBlock {
  type: string;
  [key: string]: unknown;
}
interface WireMessage {
  role: string;
  content: WireBlock[];
}

const TOOLS = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace.",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "exec_command",
    description: "Run a shell command in the workspace.",
    input_schema: { type: "object", properties: { cmd: { type: "string" } } },
  },
];

const SYSTEM = "You are a coding agent. Read before you write, and say what you changed.";

/** The parameters a request carries when no thinking level is pinned. */
const PLAIN_PARAMETERS = { thinking: { type: "adaptive", display: "summarized" } };

interface RequestSpec {
  model?: string;
  tools?: Record<string, unknown>[];
  system?: string;
  parameters?: Record<string, unknown>;
  messages?: WireMessage[];
}

function request(spec: RequestSpec = {}): RecordedRequest {
  return {
    index: 0,
    messages: [],
    config: {} as UniConfig,
    wire: spec.messages ?? [],
    wireConfig: {
      model: spec.model ?? "claude-sonnet-4-6",
      stream: true,
      // Present on every request and part of none of them: the transport flag above, the
      // window-derived output cap here, and the breakpoint below.
      max_tokens: 32000,
      cache_control: { type: "ephemeral" },
      tools: spec.tools ?? TOOLS,
      system: spec.system ?? SYSTEM,
      ...(spec.parameters ?? PLAIN_PARAMETERS),
    },
  };
}

const text = (role: string, body: string): WireMessage => ({
  role,
  content: [{ type: "text", text: body }],
});

const counted = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

const toolUses = (n: number): WireMessage => ({
  role: "assistant",
  content: counted(n).map((i) => ({
    type: "tool_use",
    id: `call_${i}`,
    name: "read_file",
    input: { path: `src/file-${i}.ts` },
  })),
});

const toolResults = (n: number): WireMessage => ({
  role: "user",
  content: counted(n).map((i) => ({
    type: "tool_result",
    tool_use_id: `call_${i}`,
    content: [{ type: "text", text: `contents of src/file-${i}.ts` }],
  })),
});

/** One opening turn, reused as the prefix every case below extends or diverges from. */
const OPENING: WireMessage[] = [text("user", "what does the entry point do?")];

/** `count` plain alternating turns, one position each. */
const turns = (count: number): WireMessage[] =>
  counted(count).map((i) => text(i % 2 === 0 ? "assistant" : "user", `turn ${i}`));

/** A simulator with no minimum, so these small fixtures exercise the hash rules alone. */
const openSim = (over: Partial<ConstructorParameters<typeof PromptCacheSim>[0]> = {}) =>
  new PromptCacheSim({ minCacheableTokens: 0, ...over });

/** The same, with the two extra breakpoints Anthropic allows alongside the automatic one. */
const widerSim = () => openSim({ breakpoints: "tools-system-automatic" });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("prompt-cache simulator", () => {
  it("serves the whole prefix when a request repeats the previous one exactly", () => {
    const sim = openSim();
    const first = request({ messages: OPENING });
    const opening = sim.request(first);
    expect(opening.cache_read_input_tokens).toBe(0);
    expect(opening.cache_creation_input_tokens).toBe(prefixTokens(first));
    expect(opening.input_tokens).toBe(0);

    const repeat = sim.request(request({ messages: OPENING }));
    expect(repeat.cache_read_input_tokens).toBe(prefixTokens(first));
    expect(repeat.cache_creation_input_tokens).toBe(0);
    expect(repeat.hitRatio).toBe(1);
  });

  it("serves the whole previous prefix to a request that only appends", () => {
    const sim = openSim();
    const first = request({ messages: OPENING });
    sim.request(first);
    const next = request({
      messages: [...OPENING, text("assistant", "it re-exports the public API"), text("user", "ok")],
    });
    const usage = sim.request(next);
    expect(usage.cache_read_input_tokens).toBe(prefixTokens(first));
    expect(usage.cache_creation_input_tokens).toBe(prefixTokens(next) - prefixTokens(first));
  });

  it("serves nothing at all across a model switch, whatever the breakpoints", () => {
    const switched = request({ model: "claude-opus-4-6", messages: OPENING });

    // The model id sits ahead of the tools, so every breakpoint's prefix moves with it: a model
    // switch is the one invalidator no breakpoint can be placed in front of.
    const wider = widerSim();
    wider.request(request({ messages: OPENING }));
    const covered = wider.request(switched);
    expect(covered.cache_read_input_tokens).toBe(0);
    expect(covered.cache_creation_input_tokens).toBe(prefixTokens(switched));

    const automatic = openSim();
    automatic.request(request({ messages: OPENING }));
    expect(automatic.request(switched).cache_read_input_tokens).toBe(0);
  });

  it("loses the system prompt on a fast-mode toggle but keeps the tools", () => {
    // `speed` and `betas` are what AgentHub sets for fast mode, and they are rendered ahead of
    // the system block: the tools survive the toggle and the system prompt does not.
    const fast = request({
      parameters: { ...PLAIN_PARAMETERS, speed: "fast", betas: ["fast-mode-2026-01-01"] },
      messages: OPENING,
    });

    const wider = widerSim();
    wider.request(request({ messages: OPENING }));
    const covered = wider.request(fast);
    expect(covered.cache_read_input_tokens).toBe(toolsTokens(fast));
    expect(covered.cache_read_input_tokens).toBeLessThan(toolsAndSystemTokens(fast));

    const automatic = openSim();
    automatic.request(request({ messages: OPENING }));
    expect(automatic.request(fast).cache_read_input_tokens).toBe(0);
  });

  it("keeps the tools past a system-prompt change only with a breakpoint on them", () => {
    const moved = request({ system: `${SYSTEM} Prefer the smallest change.`, messages: OPENING });

    const wider = widerSim();
    wider.request(request({ messages: OPENING }));
    const covered = wider.request(moved);
    expect(covered.cache_read_input_tokens).toBe(toolsTokens(moved));
    expect(covered.cache_read_input_tokens).toBeLessThan(toolsAndSystemTokens(moved));

    // With the single automatic breakpoint the harness sends, no request ever closed an entry
    // at the tools boundary, so there is nothing behind the divergence to read.
    const automatic = openSim();
    automatic.request(request({ messages: OPENING }));
    expect(automatic.request(moved).cache_read_input_tokens).toBe(0);
  });

  it("keeps the tools and system prompt past a parameter change only with a breakpoint", () => {
    const thinking = request({
      parameters: { ...PLAIN_PARAMETERS, output_config: { effort: "high" } },
      messages: OPENING,
    });

    const wider = widerSim();
    wider.request(request({ messages: OPENING }));
    const covered = wider.request(thinking);
    expect(covered.cache_read_input_tokens).toBe(toolsAndSystemTokens(thinking));
    // The parameters block sits after the system block and no breakpoint closes it, so the
    // parameters themselves are never part of what a diverged request reads back.
    expect(covered.cache_read_input_tokens).toBeLessThan(fixedPrefixTokens(thinking));

    const automatic = openSim();
    automatic.request(request({ messages: OPENING }));
    expect(automatic.request(thinking).cache_read_input_tokens).toBe(0);
  });

  it("ignores the parameters that take no part in the prefix", () => {
    const sim = openSim();
    const first = request({ messages: OPENING });
    sim.request(first);
    // A different output cap and a different breakpoint spelling: same cached prefix.
    const relaxed = request({ messages: OPENING });
    relaxed.wireConfig.max_tokens = 8000;
    relaxed.wireConfig.cache_control = { type: "ephemeral", ttl: "1h" };
    expect(sim.request(relaxed).cache_read_input_tokens).toBe(prefixTokens(first));
  });

  it("falls back to the last breakpoint ahead of an edited message", () => {
    const sim = openSim();
    const history = [
      text("user", "read the README"),
      text("assistant", "it describes the layout"),
      text("user", "and the packages?"),
    ];
    const opening = request({ messages: history.slice(0, 1) });
    sim.request(opening);
    sim.request(request({ messages: history }));
    // The third message is rewritten: the write that covered it is gone, and the read falls
    // back to the one breakpoint still ahead of the divergence — the opening request's.
    const edited = request({
      messages: [...history.slice(0, 2), text("user", "and the plugins?")],
    });
    expect(sim.request(edited).cache_read_input_tokens).toBe(prefixTokens(opening));
  });

  it("never caches a prefix below the provider's minimum", () => {
    const tiny: RequestSpec = { tools: [], system: "be brief", messages: OPENING };
    const strict = new PromptCacheSim();
    const first = strict.request(request(tiny));
    expect(first.wrote).toBe(false);
    expect(first.cache_creation_input_tokens).toBe(0);
    expect(first.input_tokens).toBe(prefixTokens(request(tiny)));
    expect(strict.request(request(tiny)).cache_read_input_tokens).toBe(0);
    // The same prefix under a simulator with no minimum does cache — it is the size that
    // refuses it, nothing about the bytes.
    const relaxed = openSim();
    const opening = request(tiny);
    relaxed.request(opening);
    expect(relaxed.request(request(tiny)).cache_read_input_tokens).toBe(prefixTokens(opening));
  });

  it("expires an entry once the TTL passes since its last use, and a read refreshes it", () => {
    let clock = 1_000_000;
    const sim = openSim({ now: () => clock });
    const opening = request({ messages: OPENING });
    sim.request(opening);

    // The middle request extends the prefix instead of repeating it, so the entry it writes is
    // a different one: nothing but the read itself can keep the opening prefix alive.
    clock += DEFAULT_TTL_MS - 1;
    const extended = request({
      messages: [...OPENING, text("assistant", "it re-exports the public API"), text("user", "ok")],
    });
    expect(sim.request(extended).cache_read_input_tokens).toBe(prefixTokens(opening));

    // Just short of a second lifetime after that read, and well past the first one.
    clock += DEFAULT_TTL_MS - 1;
    expect(sim.request(request({ messages: OPENING })).cache_read_input_tokens).toBe(
      prefixTokens(opening),
    );

    clock += DEFAULT_TTL_MS + 1;
    const cold = sim.request(request({ messages: OPENING }));
    expect(cold.cache_read_input_tokens).toBe(0);
    expect(cold.cache_creation_input_tokens).toBe(prefixTokens(opening));
  });

  it("checks twenty positions per breakpoint, the breakpoint counting as the first", () => {
    const within = openSim();
    const opening = request({ messages: OPENING });
    within.request(opening);
    const nineteen = request({ messages: [...OPENING, ...turns(19)] });
    expect(positionCount(nineteen) - positionCount(opening)).toBe(19);
    expect(within.request(nineteen).cache_read_input_tokens).toBe(prefixTokens(opening));

    // One position further and the previous write is out of reach: the request pays in full.
    const beyond = openSim();
    beyond.request(request({ messages: OPENING }));
    const twenty = request({ messages: [...OPENING, ...turns(20)] });
    expect(beyond.request(twenty).cache_read_input_tokens).toBe(0);
  });

  it("gives every breakpoint its own lookback window, anchored at its own position", () => {
    const opening = request({ messages: OPENING });
    // Far past the twenty positions any one window reaches back, so a read can only come from a
    // breakpoint that sits next to what it is looking for.
    const far = request({ messages: [...OPENING, ...turns(40)] });
    expect(positionCount(far) - positionCount(opening)).toBeGreaterThan(20);

    const wider = widerSim();
    wider.request(opening);
    // The system breakpoint looks back from the system block, where the entry it wants sits at
    // distance zero; only the automatic breakpoint is out of reach of the earlier write.
    expect(wider.request(far).cache_read_input_tokens).toBe(toolsAndSystemTokens(far));

    const automatic = openSim();
    automatic.request(request({ messages: OPENING }));
    expect(automatic.request(far).cache_read_input_tokens).toBe(0);
  });

  it("collapses a run of tool calls or tool results into one position", () => {
    const sim = openSim();
    const opening = request({ messages: OPENING });
    sim.request(opening);
    const round = request({ messages: [...OPENING, toolUses(25), toolResults(25)] });
    // Fifty blocks, two positions: a wide parallel round stays within reach of the lookback.
    expect(positionCount(round) - positionCount(opening)).toBe(2);
    expect(sim.request(round).cache_read_input_tokens).toBe(prefixTokens(opening));
  });

  it("keeps a write invisible until its request completes", () => {
    const sim = openSim();
    const parent = request({ messages: OPENING });
    sim.begin(parent);
    // A second request issued while the first is still streaming: nothing to read yet.
    const sibling = request({ messages: OPENING });
    expect(sim.begin(sibling).cache_read_input_tokens).toBe(0);
    sim.complete(parent);
    sim.complete(sibling);
    expect(sim.request(request({ messages: OPENING })).cache_read_input_tokens).toBe(
      prefixTokens(parent),
    );
  });
});
