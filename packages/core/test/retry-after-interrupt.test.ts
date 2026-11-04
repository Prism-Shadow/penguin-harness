/**
 * Retry after the user stops a run: a run with no input of its own (what a host's Retry starts)
 * sends what the interrupted turn left held, as the user's next message would have carried it,
 * and nothing else.
 *
 * - Given the user stops the model mid-reply, when a run with no input follows, then its one
 *   request carries the interrupted turn as a single `[turn_aborted]` message holding the
 *   original input once and the partial reply, the Trace gains no user input, and nothing is
 *   held afterwards.
 * - Given the user stops the turn while its committed tool calls wait for approval, when a run
 *   with no input follows, then its request answers every committed call with a structured
 *   output and carries no user text.
 * - Given the user sends a new message after stopping, then that message takes the held turn
 *   with it: nothing is held any more, and a run with no input sends no request.
 */
import { describe, expect, it } from "vitest";
import {
  assistantText,
  emptyTokenCounts,
  tokenUsage,
  toolCall,
  userText,
} from "@prismshadow/amsp/records";
import type { AmspRecord, TextPayload } from "@prismshadow/amsp/records";
import type { EnvironmentInterface, LLMInterface, LLMOutcome } from "../src/interfaces/index.js";
import type { TraceSink } from "../src/engine/context-engine.js";
import { ContextEngine } from "../src/engine/context-engine.js";

/** Tools are never executed here: every call is either stopped before dispatch or absent. */
const environment: EnvironmentInterface = {
  listTools: async () => [],
  // eslint-disable-next-line require-yield
  executeTool: async function* () {
    throw new Error("not used");
  },
  toolPermission: () => undefined,
};

const usage = (): AmspRecord =>
  tokenUsage(emptyTokenCounts(), { cache_read: 0, cache_write: 0, output: 1, total: 1 });

/** Plays one scripted turn per request and keeps the input each request was sent. */
function scriptedLLM(
  turns: Array<() => AsyncGenerator<AmspRecord, LLMOutcome>>,
): LLMInterface & { inputs: AmspRecord[][] } {
  const inputs: AmspRecord[][] = [];
  return {
    inputs,
    streamGenerate({ newMessages }) {
      inputs.push(newMessages);
      const turn = turns.shift();
      if (!turn) throw new Error("no scripted turn left");
      return turn();
    },
  };
}

/** A reply that completes. */
async function* answer(): AsyncGenerator<AmspRecord, LLMOutcome> {
  yield assistantText("done");
  yield usage();
  return { status: "completed" };
}

function recordingTrace(): TraceSink & { written: AmspRecord[] } {
  const written: AmspRecord[] = [];
  return {
    written,
    write: async (msg) => {
      written.push(msg);
    },
  };
}

async function drain(gen: AsyncGenerator<AmspRecord, unknown>): Promise<AmspRecord[]> {
  const out: AmspRecord[] = [];
  for await (const msg of gen) out.push(msg);
  return out;
}

const typeOf = (m: AmspRecord): string | undefined => (m.payload as { type?: string }).type;
const isUserText = (m: AmspRecord): boolean =>
  typeOf(m) === "text" && (m.payload as TextPayload).role === "user";
const textOf = (m: AmspRecord): string => (m.payload as TextPayload).text;

const ASK = "draft the release notes";

describe("Retry after an interruption", () => {
  it("a stopped reply is resent once, as one [turn_aborted] message carrying the partial output", async () => {
    const llm = scriptedLLM([
      // The user stops the stream half-way through the reply.
      async function* () {
        yield assistantText("Here are the rel");
        return { status: "aborted" };
      },
      answer,
    ]);
    const trace = recordingTrace();
    const engine = new ContextEngine({ llm, environment, trace });

    const stopped = await drain(engine.run([userText(ASK)], { approve: async () => "allow" }));
    expect(stopped.map(typeOf)).toContain("abort");
    expect(engine.hasPendingInput()).toBe(true);
    const userRecords = trace.written.filter(isUserText).length;

    await drain(engine.run([], { approve: async () => "allow" }));

    expect(llm.inputs).toHaveLength(2);
    const [resent, ...rest] = llm.inputs[1]!;
    expect(rest).toEqual([]);
    const text = textOf(resent!);
    expect(text.startsWith("[turn_aborted]")).toBe(true);
    // The original ask rides inside the block exactly once, next to what the model had written.
    expect(text.split(ASK)).toHaveLength(2);
    expect(text).toContain("Here are the rel");
    // A user stop is no failure: there is no error for the model to read.
    expect(text).not.toContain("[request_error");
    // No new input reaches the Trace, so the transcript shows the ask once.
    expect(trace.written.filter(isUserText)).toHaveLength(userRecords);
    expect(engine.hasPendingInput()).toBe(false);
  });

  it("a turn stopped while its tool calls await approval answers every committed call", async () => {
    const llm = scriptedLLM([
      async function* () {
        yield toolCall({ name: "exec_command", arguments: "{}", toolCallId: "a1" });
        yield toolCall({ name: "exec_command", arguments: "{}", toolCallId: "a2" });
        yield usage();
        return { status: "completed" };
      },
      answer,
    ]);
    const engine = new ContextEngine({ llm, environment });
    const stop = new AbortController();
    // The user presses Stop while the first call is waiting for approval.
    const approve = async (): Promise<"allow"> => {
      stop.abort();
      return "allow";
    };

    await drain(engine.run([userText(ASK)], { approve, signal: stop.signal }));
    await drain(engine.run([], { approve: async () => "allow" }));

    const resent = llm.inputs[1]!;
    expect(resent.map(typeOf)).toEqual(["tool_call_output", "tool_call_output"]);
    expect(resent.map((m) => (m.payload as { tool_call_id: string }).tool_call_id)).toEqual([
      "a1",
      "a2",
    ]);
    expect(resent.some(isUserText)).toBe(false);
  });

  it("a message sent after the stop takes the held turn along, leaving nothing to retry", async () => {
    const llm = scriptedLLM([
      async function* () {
        yield assistantText("Here are");
        return { status: "aborted" };
      },
      answer,
    ]);
    const engine = new ContextEngine({ llm, environment });

    await drain(engine.run([userText(ASK)], { approve: async () => "allow" }));
    await drain(engine.run([userText("shorter, please")], { approve: async () => "allow" }));
    expect(engine.hasPendingInput()).toBe(false);

    const retried = await drain(engine.run([], { approve: async () => "allow" }));
    expect(retried).toEqual([]);
    expect(llm.inputs).toHaveLength(2);
  });
});
