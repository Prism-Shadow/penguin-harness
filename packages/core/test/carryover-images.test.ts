/**
 * Abort carry-over with image input — the measured boundary of the `TODO(multimodal)` in
 * `src/engine/context-engine.ts` (`flattenCarryOver`).
 *
 * A turn whose model output was interrupted mid-stream (case B: nothing was committed, so the
 * aborted turn's input must be resent on the next `run`) is folded into a carry-over: the input's
 * text and the turn's thinking/text/tool calls are transcribed into one `[turn_aborted]`
 * plain-text user message, while a structured `tool_call_output` in the input is kept as-is,
 * because it pairs with the previous turn's committed `tool_call` and cannot be turned into text.
 *
 * The third kind of content a Prompt can carry — an image message (a vision model's input; a
 * model without vision has its images folded into text paths by the caller, see
 * `ContextEngineDeps.foldInputImages`) — used to be dropped by that filter: the flattened text
 * carries the input's **text** only, so the picture the user attached to the aborted turn came
 * back without it. These tests pin what the carry-over keeps: the aborted turn's image rides
 * behind the `[turn_aborted]` block, exactly the text-then-images shape a Prompt (and a
 * `[user_steering]` message) uses, so the next request resends the picture with the transcription.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextEngine } from "../src/engine/context-engine.js";
import { Environment } from "../src/environment/index.js";
import {
  assistantText,
  imageUrlMessage,
  inlineData,
  thinkingMessage,
  userText,
} from "../src/omnimessage/index.js";
import type {
  ApproveFn,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
} from "../src/interfaces/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";

/** A real 1x1 PNG data URL: the smallest input that is genuinely an image. */
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** The base64 body of the same 1x1 PNG, for the `inline_data` shape of the same input. */
const PNG_BASE64 = PNG_DATA_URL.slice("data:image/png;base64,".length);

/**
 * Records every request's input. The first call is interrupted mid-stream and returns
 * `aborted` — case B, the only status that reaches `flattenCarryOver` (a `completed` turn
 * carries its tool outputs over structurally instead).
 */
class AbortOnceLLM implements LLMInterface {
  readonly requests: OmniMessage[][] = [];

  async *streamGenerate(
    params: GenerativeModelParameters,
  ): AsyncGenerator<OmniMessage, LLMOutcome> {
    this.requests.push(params.newMessages);
    if (this.requests.length === 1) {
      yield thinkingMessage("half thought", "aborted");
      return { status: "aborted" };
    }
    yield assistantText("fine");
    return { status: "completed" };
  }
}

const allowAll: ApproveFn = async () => "allow";

const typeOf = (m: OmniMessage): string | undefined => (m.payload as { type?: string }).type;

/** The `[turn_aborted]` blocks the input carries (the flatten carry-over). */
const abortedBlocks = (msgs: OmniMessage[]): string[] =>
  msgs
    .map((m) => m.payload as { type?: string; text?: string })
    .filter((p) => p.type === "text" && (p.text ?? "").startsWith("[turn_aborted]"))
    .map((p) => p.text ?? "");

/** The image URLs the input carries as image messages, in order. */
const imageUrls = (msgs: OmniMessage[]): string[] =>
  msgs
    .filter((m) => typeOf(m) === "image_url")
    .map((m) => (m.payload as { image_url: string }).image_url);

const firstAbortedIndex = (msgs: OmniMessage[]): number =>
  msgs.findIndex((m) => abortedBlocks([m]).length > 0);

const firstImageIndex = (msgs: OmniMessage[]): number =>
  msgs.findIndex((m) => typeOf(m) === "image_url" || typeOf(m) === "inline_data");

async function collectRun(
  engine: ContextEngine,
  prompt: OmniMessage[],
  approve: ApproveFn,
): Promise<OmniMessage[]> {
  const all: OmniMessage[] = [];
  for await (const msg of engine.run(prompt, { approve })) all.push(msg);
  return all;
}

describe("abort carry-over keeps the aborted turn's image input", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-carryimg-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  /** An engine over a tool-less Environment: these tests never dispatch a tool. */
  const makeEngine = (llm: LLMInterface): ContextEngine =>
    new ContextEngine({
      llm,
      environment: new Environment({
        workspaceDir: workspace,
        toolConfig: { customTools: [], mcpServers: [] },
      }),
    });

  it("an `image_url` input survives the flatten into the next request", async () => {
    const llm = new AbortOnceLLM();
    const engine = makeEngine(llm);

    await collectRun(
      engine,
      [userText("what is in this picture?"), imageUrlMessage(PNG_DATA_URL)],
      allowAll,
    );

    // Sanity: the aborted turn itself really carried the image, so a loss below is the
    // carry-over's and not the input's.
    expect(imageUrls(llm.requests[0]!)).toEqual([PNG_DATA_URL]);

    await collectRun(engine, [userText("continue")], allowAll);

    const carried = llm.requests[1]!;
    // The input's text is transcribed into the `[turn_aborted]` block, with the interrupted
    // turn's produced thinking behind it.
    const blocks = abortedBlocks(carried);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("[user_input]what is in this picture?[/user_input]");
    expect(blocks[0]).toContain("[thinking]half thought[/thinking]");

    // The image is still there, once, behind the transcribed block.
    expect(imageUrls(carried)).toEqual([PNG_DATA_URL]);
    expect(firstAbortedIndex(carried)).toBeLessThan(firstImageIndex(carried));
  });

  it("an `inline_data` input survives the flatten into the next request", async () => {
    const llm = new AbortOnceLLM();
    const engine = makeEngine(llm);

    await collectRun(
      engine,
      [userText("and this one"), inlineData("user", PNG_BASE64, "image/png")],
      allowAll,
    );

    expect(
      llm.requests[0]!.filter((m) => typeOf(m) === "inline_data").map((m) => m.payload),
    ).toHaveLength(1);

    await collectRun(engine, [userText("continue")], allowAll);

    const carried = llm.requests[1]!;
    expect(abortedBlocks(carried)).toHaveLength(1);
    const inline = carried.filter((m) => typeOf(m) === "inline_data");
    expect(inline).toHaveLength(1);
    expect(inline[0]!.payload).toMatchObject({
      type: "inline_data",
      mime_type: "image/png",
      data: PNG_BASE64,
    });
    expect(firstAbortedIndex(carried)).toBeLessThan(firstImageIndex(carried));
  });

  it("an image-free aborted turn still flattens to the transcribed block alone", async () => {
    const llm = new AbortOnceLLM();
    const engine = makeEngine(llm);

    await collectRun(engine, [userText("plain ask")], allowAll);
    await collectRun(engine, [userText("continue")], allowAll);

    const carried = llm.requests[1]!;
    expect(carried.filter((m) => typeOf(m) === "text")).toHaveLength(2); // the block + "continue"
    expect(abortedBlocks(carried)).toHaveLength(1);
    expect(carried.filter((m) => typeOf(m) === "image_url")).toHaveLength(0);
    expect(carried.filter((m) => typeOf(m) === "inline_data")).toHaveLength(0);
  });
});
