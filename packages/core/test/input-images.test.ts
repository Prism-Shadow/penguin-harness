/**
 * imagesToScratchpadPaths unit tests: input conversion when the session model does not support
 * images -- data URL images are written to the session scratchpad and their paths appended to the
 * user text; http(s) URLs are referenced as-is; image messages are removed from the input;
 * image-free input is returned unchanged; images that fail to parse are replaced with an explanatory line.
 *
 * Plus appendAttachmentLines, the placement rule both attachment-line producers share (the
 * images above and the server's `[attached file: …]` uploads).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendAttachmentLines, imagesToScratchpadPaths } from "../src/internal/session-support.js";
import { Session } from "../src/index.js";
import type {
  EnvironmentInterface,
  LLMInterface,
  LLMOutcome,
  OmniMessage,
  SessionMetaPayload,
} from "../src/index.js";
import {
  assistantText,
  buildHandoffMessage,
  buildModelSwitchMessage,
  buildScheduledMessage,
  buildSkillsMessage,
  imageUrlMessage,
  parseHandoffMessage,
  parseModelSwitchMessage,
  userText,
} from "../src/omnimessage/index.js";
import type { TextPayload } from "../src/omnimessage/index.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DATA_URL = `data:image/png;base64,${PNG_1X1.toString("base64")}`;

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-inputimg-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("imagesToScratchpadPaths", () => {
  it("data URL images are saved to disk, paths appended to the user text, image messages removed", async () => {
    const dir = path.join(tmp, "scratch", "session-1"); // auto-created if the directory doesn't exist
    const out = await imagesToScratchpadPaths(
      [userText("Look at these two images"), imageUrlMessage(DATA_URL), imageUrlMessage(DATA_URL)],
      dir,
    );

    expect(out).toHaveLength(1);
    const p = out[0]!.payload as TextPayload;
    expect(p.type).toBe("text");
    expect(p.role).toBe("user");
    expect(p.text.startsWith("Look at these two images\n\n")).toBe(true);
    const paths = [...p.text.matchAll(/\[attached image: ([^\]]+)\]/g)].map((m) => m[1]!);
    expect(paths).toHaveLength(2);

    // The saved content matches the original image; filename = upload-<8-char random hex>.<extension by mime type>.
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    for (const f of paths) {
      expect(path.dirname(f)).toBe(dir);
      expect(path.basename(f)).toMatch(/^upload-[0-9a-f]{8}\.png$/);
      expect(await readFile(f)).toEqual(PNG_1X1);
    }
    // The two images' random names differ from each other.
    expect(new Set(paths).size).toBe(2);
  });

  it("http(s) URLs are not saved but referenced as-is; image-only input gets a paths-only text message", async () => {
    const out = await imagesToScratchpadPaths([imageUrlMessage("https://example.com/a.png")], tmp);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload as TextPayload;
    expect(p.type).toBe("text");
    expect(p.text).toBe("[attached image: https://example.com/a.png]");
    expect(await readdir(tmp)).toHaveLength(0);
  });

  it("input without images is returned as-is (never touches the filesystem)", async () => {
    const input = [userText("plain text")];
    const out = await imagesToScratchpadPaths(input, path.join(tmp, "untouched"));
    expect(out).toBe(input);
  });

  it("an unparsable image is replaced with an explanatory line, never silently dropped", async () => {
    const out = await imagesToScratchpadPaths(
      [userText("hi"), imageUrlMessage("data:text/plain,oops")],
      tmp,
    );
    const p = out[0]!.payload as TextPayload;
    expect(p.text).toContain("could not be saved");
  });
});

/** Text of the message at `index` of an appendAttachmentLines result. */
const textAt = (out: ReturnType<typeof appendAttachmentLines>, index: number): string =>
  (out[index]!.payload as TextPayload).text;

describe("appendAttachmentLines placement", () => {
  const LINE = "[attached file: /d/scratchpad/s1/report.pdf]";

  it("appends to the last user text message", () => {
    const out = appendAttachmentLines([userText("first"), userText("second")], [LINE]);
    expect(out).toHaveLength(2);
    expect(textAt(out, 0)).toBe("first");
    expect(textAt(out, 1)).toBe(`second\n\n${LINE}`);
  });

  it("no user text at all: the lines become a message of their own", () => {
    const out = appendAttachmentLines([], [LINE]);
    expect(out).toHaveLength(1);
    expect(textAt(out, 0)).toBe(LINE);
  });

  it("a whole-message origin block is left alone; the lines get their own message", () => {
    // The composer's files-only-plus-staged-handoff shape: the only text message is the origin
    // block, and both of these parsers require the block to be the WHOLE message — appending to
    // it would render the raw marker in a user bubble instead of a one-line banner.
    for (const block of [
      buildHandoffMessage({ agentId: "alpha", agentName: "Alpha", sessionId: "s0" }),
      buildModelSwitchMessage({ sessionId: "s0", prevModelId: "m0" }),
    ]) {
      const out = appendAttachmentLines([userText(block)], [LINE]);
      expect(out).toHaveLength(2);
      expect(textAt(out, 0)).toBe(block);
      expect(textAt(out, 1)).toBe(LINE);
    }
    // …and the blocks still parse afterwards, which is the property that actually matters.
    const handoff = appendAttachmentLines(
      [userText(buildHandoffMessage({ agentId: "alpha", sessionId: "s0" }))],
      [LINE],
    );
    expect(parseHandoffMessage(textAt(handoff, 0))?.agentId).toBe("alpha");
    const switched = appendAttachmentLines(
      [userText(buildModelSwitchMessage({ sessionId: "s0" }))],
      [LINE],
    );
    expect(parseModelSwitchMessage(textAt(switched, 0))?.sessionId).toBe("s0");
  });

  it("prefix blocks still take the lines after their body ([use_skills] / [scheduled_task])", () => {
    // The other direction: these two are parsed at index 0 and keep the body that follows, so a
    // trailing line is an ordinary footnote to the message and must NOT start a new one.
    for (const message of [
      buildSkillsMessage(["web-design"], "fix the layout"),
      buildScheduledMessage("nightly", "2026-07-29T02:00:00Z", "run the report"),
    ]) {
      const out = appendAttachmentLines([userText(message)], [LINE]);
      expect(out).toHaveLength(1);
      expect(textAt(out, 0)).toBe(`${message}\n\n${LINE}`);
    }
  });

  it("an earlier ordinary message wins over a trailing origin block", () => {
    const block = buildHandoffMessage({ agentId: "alpha" });
    const out = appendAttachmentLines([userText("hello"), userText(block)], [LINE]);
    expect(out).toHaveLength(2);
    expect(textAt(out, 0)).toBe(`hello\n\n${LINE}`);
    expect(textAt(out, 1)).toBe(block);
  });
});

/**
 * Session's own wiring of the fold, which is where the per-input rules live: a Prompt and a
 * steering message fold only without vision, and BOTH keep the throwing conversion. Steering
 * used to get a copy that swallowed a disk failure and delivered the text with the images
 * replaced by a note; it does not any more, because a picture sent mid-run usually arrives
 * *because* the run is going the wrong way — carrying on without it spends the rest of the
 * Task heading further that way. The engine only ever awaits what Session hands it, so this
 * is the layer the rule actually lives in.
 */
describe("Session input-image wiring", () => {
  const fakeEnvironment: EnvironmentInterface = {
    listTools: async () => [],
    // eslint-disable-next-line require-yield
    executeTool: async function* () {
      throw new Error("not used");
    },
    toolPermission: () => undefined,
  };

  const meta = (): SessionMetaPayload => ({
    session_id: "session-1",
    provider: "custom",
    model_id: "m1",
    model_context_window: 1000,
    system_prompt: "sp",
    tools: [],
    agent_state: tmp,
    workspace: tmp,
  });

  /** An LLM that steers once from inside its first request, then answers. */
  function steeringLLM(steer: () => void): LLMInterface {
    let turn = 0;
    return {
      async *streamGenerate(): AsyncGenerator<OmniMessage, LLMOutcome> {
        if (++turn === 1) steer();
        yield assistantText(`turn ${turn}`);
        return { status: "completed" };
      },
    };
  }

  /** A path that cannot be created: `<tmp>/blocker` is a regular file, so mkdir under it fails. */
  async function unwritableDir(): Promise<string> {
    const blocker = path.join(tmp, "blocker");
    await writeFile(blocker, "not a directory", "utf8");
    return path.join(blocker, "session-1");
  }

  it("a steering image that cannot be saved ends the run instead of being dropped with a note", async () => {
    let session!: Session;
    session = new Session({
      meta: meta(),
      llm: steeringLLM(() => {
        expect(session.steer([userText("look at this"), imageUrlMessage(DATA_URL)])).toBe(true);
      }),
      environment: fakeEnvironment,
      imagesDir: await unwritableDir(),
      modelHasVision: false,
    });

    const drain = async () => {
      for await (const _ of session.run([userText("go")])) {
        // consume
      }
    };
    await expect(drain()).rejects.toThrow(/ENOTDIR|ENOENT|EEXIST|not a directory/i);
  });

  it("a vision model gets no fold at all, so an unwritable scratchpad never comes up", async () => {
    // The engine is handed no converter when the model takes images: the steering images ride
    // as messages and nothing touches the directory, broken or not.
    const inputs: OmniMessage[][] = [];
    let session!: Session;
    session = new Session({
      meta: meta(),
      llm: {
        async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
          inputs.push(params.newMessages);
          if (inputs.length === 1) {
            expect(session.steer([userText("look at this"), imageUrlMessage(DATA_URL)])).toBe(true);
          }
          yield assistantText(`turn ${inputs.length}`);
          return { status: "completed" };
        },
      },
      environment: fakeEnvironment,
      imagesDir: await unwritableDir(),
      modelHasVision: true,
    });

    for await (const _ of session.run([userText("go")])) {
      // consume
    }
    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.map((m) => (m.payload as { type: string }).type)).toEqual([
      "text",
      "image_url",
    ]);
  });
});
