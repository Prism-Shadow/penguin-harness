/**
 * MessageStream hands the links in its Markdown the conversation's Workspace and file opener
 * (react-dom/server static markup, node env, no DOM). Static markup carries no handlers, so
 * replyLinkBehavior is wrapped rather than replaced: every call still returns the real behaviour,
 * and the test keeps what the link adapter spread onto each rendered anchor in order to click it.
 * It also draws a run-ending LLM failure as its error banner, with a hint under a context overflow.
 * The line a run ended on — that banner, or the marker of a run the user stopped — offers Retry
 * while it is the stream's last item and no Task runs.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageStream } from "../src/features/chat/message-stream";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/omni/stream-model";
import type { LinkBehavior } from "../src/lib/reply-link";
import { S } from "../src/lib/strings";

/** The behaviour each rendered link received, by the href it was sorted from. */
const rendered = vi.hoisted(() => new Map<string | undefined, LinkBehavior>());

vi.mock("../src/lib/reply-link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/reply-link")>();
  return {
    ...actual,
    replyLinkBehavior: (...args: Parameters<typeof actual.replyLinkBehavior>) => {
      const behavior = actual.replyLinkBehavior(...args);
      rendered.set(args[0], behavior);
      return behavior;
    },
  };
});

const WS = "/home/user/workspaces/tmp-1";

/** All rendered <a ...> opening tags. */
const anchors = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

describe("MessageStream links", () => {
  it("a reply's link to a Workspace file renders without a target, and its click opens the file", () => {
    const onOpenFile = vi.fn();
    const ctx: StreamRenderContext = {
      pendingApprovals: new Map(),
      onApprove: async () => {},
      origin: [],
      taskRunning: false,
      workspace: WS,
      onOpenFile,
    };
    const html = renderToStaticMarkup(
      createElement(MessageStream, {
        items: [
          {
            kind: "assistant_text",
            id: 1,
            text: `[a](a.html) and [b](${WS}/out/b.html)`,
            streaming: false,
          },
        ],
        version: 1,
        ctx,
        // Every stream belongs to a conversation with a composer to stage an excerpt in.
        onAddExcerpt: () => {},
      }),
    );
    const tags = anchors(html);
    expect(tags).toHaveLength(2);
    for (const tag of tags) expect(tag).not.toContain("target=");
    // The absolute href resolves only because the stream passed its Workspace along.
    for (const [href, path] of [
      ["a.html", "a.html"],
      [`${WS}/out/b.html`, "out/b.html"],
    ] as const) {
      const preventDefault = vi.fn();
      onOpenFile.mockClear();
      rendered.get(href)!.onClick!({ preventDefault } as unknown as MouseEvent<HTMLAnchorElement>);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(path);
    }
  });
});

describe("MessageStream error banner", () => {
  const ctx: StreamRenderContext = {
    pendingApprovals: new Map(),
    onApprove: async () => {},
    origin: [],
    taskRunning: false,
  };
  const banner = (errorCode: string) =>
    renderToStaticMarkup(
      createElement(MessageStream, {
        items: [{ kind: "llm_error", id: 1, errorCode, errorMessage: "400 Bad Request" }],
        version: 1,
        ctx,
        onAddExcerpt: () => {},
      }),
    );

  const stream = (items: ChatItem[], taskRunning = false) =>
    renderToStaticMarkup(
      createElement(MessageStream, {
        items,
        version: 1,
        ctx: { ...ctx, taskRunning, onRetry: async () => {} },
        onAddExcerpt: () => {},
      }),
    );
  const retry = `>${S.chat.retryRun}</button>`;
  // A Retry run's reply lands right after the line: the held input has been sent again.
  const reply: ChatItem = { kind: "assistant_text", id: 2, text: "Done.", streaming: false };

  it.each<[string, ChatItem]>([
    ["a failed run's banner", { kind: "llm_error", id: 1, errorMessage: "400 Bad Request" }],
    ["a stopped run's marker", { kind: "abort", id: 1, errorCode: "user_abort" }],
  ])("%s offers Retry as the last line while no Task runs, and not otherwise", (_, ended) => {
    expect(stream([ended])).toContain(retry);
    expect(stream([ended, reply])).not.toContain(retry);
    expect(stream([ended], true)).not.toContain(retry);
  });
});


/**
 * The streamed-history read (web/src/lib/amsp/stream-controller.ts loadFrames over
 * deps.loadMessageFrames), driven the way the wire delivers it — NDJSON frames handed to
 * onFrame one line at a time:
 * - The skeleton frames arrive first and fix every row's position in one pass: prompts and
 *   the inserted kinds (steering chips) all become rows before any content fills in.
 * - The meat frames fill the interiors with zero row movement: a steering chip's row never
 *   re-inserts after layout, and the fill of a finished Task only appends inside it.
 * - A resumed read replays frames the client already holds; the dedup drops those and the
 *   sequence continues where the interrupted stream stopped.
 */
import { assistantText, toolCall, toolCallOutput, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { userSteeringText } from "@prismshadow/penguin-core/markers";
import { createStreamController } from "../src/lib/omni/stream-controller";
import type { MessagesPageQuery, StreamController } from "../src/lib/omni/stream-controller";
import type { MessagesHistoryFrame } from "../src/api/endpoints";

type FrameSink = (frame: MessagesHistoryFrame) => void;

/** Item kinds of the model, in order. */
const kinds = (h: Harness): string[] => h.controller.model.items.map((i) => i.kind);

/** The texts of the user_text rows, in order. */
const userTexts = (h: Harness): Array<string | null> =>
  h.controller.model.items.map((i) => (i.kind === "user_text" ? i.text : null));

interface Harness {
  controller: StreamController;
  errors: Array<string | null>;
  served: Array<MessagesPageQuery | undefined>;
  /** Deliver the scripted frames for one load call. */
  serve: () => void;
}

/**
 * A frames harness: each load() takes one script entry and delivers its frames line by
 * line (the NDJSON wire's delivery), then resolves.
 */
function createFramesHarness(script: Array<{ frames: MessagesHistoryFrame[] }>): Harness {
  const served: Array<MessagesPageQuery | undefined> = [];
  const errors: Array<string | null> = [];
  let cursor = 0;
  const controller = createStreamController({
    sessionId: "s1",
    loadMessages: () => {
      throw new Error("the JSON read must not run when the frames path serves");
    },
    loadMessageFrames: (page: MessagesPageQuery | undefined, onFrame: FrameSink) => {
      served.push(page);
      const entry = script[cursor++]!;
      for (const frame of entry.frames) onFrame(frame);
      return Promise.resolve({ serverNowMs: null });
    },
    onTaskState: () => {},
    onPendingSteering: () => {},
    onReturnedSteering: () => {},
    onPendingFollowUps: () => {},
    onLoading: () => {},
    onError: (e) => errors.push(e),
    onModelChange: () => {},
    onPendingChange: () => {},
    now: () => 1_000_000,
  });
  return { controller, errors, served, serve: () => {} };
}

function at<M extends OmniMessage>(msg: M, ts: string): M {
  return { ...msg, timestamp: ts };
}

const T = (m: number, s: string) => `2026-07-05T00:0${m}:0${s}.000Z`;

/** The page envelope frame for a full tail read (zeroed priors). */
const pageFrame = (): MessagesHistoryFrame => ({
  type: "page",
  earlierTurns: 0,
  prior: { subagentTokens: 0, elapsedMs: 0, apiMs: 0, toolMs: 0, sessionTokens: 0, contextTokens: 0 },
});

describe("the streamed-history read", () => {
  it("REGRESSION (2026-10-31 53531 mis-ordering): frames arriving in trace order lay the transcript out in trace order — an older unit's tool work never lands after a newer unit's prompt", async () => {
    // Three units with tool work, the window covering all of them, the server emitting
    // the fixed shape: openers of units older than the window first (none here), then
    // the window's own stream — each unit's opener immediately followed by its
    // interior, split across chunked frames. The reducer appends; arrival order is
    // trace order, so the rows come out right. (The defect shape — every opener of
    // the transcript emitted ahead of all interiors — produced q1|q2|q3|tool|a1|…)
    const units = [1, 2, 3].map((n) => ({
      prompt: at(userText(`q${n}`), T(n - 1, "0")),
      call: at(toolCall({ name: "exec", arguments: "{}", toolCallId: `t${n}` }), T(n - 1, "2")),
      output: at(toolCallOutput({ output: "done", toolCallId: `t${n}` }), T(n - 1, "4")),
      reply: at(assistantText(`a${n}`), T(n - 1, "6")),
    }));
    const stream: MessagesHistoryFrame[] = [];
    for (const u of units) {
      stream.push({ type: "meat", cursor: "0:0", messages: [u.prompt] });
      stream.push({ type: "meat", cursor: "0:0", messages: [u.call, u.output] });
      stream.push({ type: "meat", cursor: "0:0", messages: [u.reply] });
    }
    const h = createFramesHarness([{ frames: [pageFrame(), ...stream] }]);
    await h.controller.load();
    expect(h.errors.filter((e) => e !== null)).toEqual([]);
    expect(kinds(h)).toEqual([
      "user_text", "tool_call", "assistant_text",
      "user_text", "tool_call", "assistant_text",
      "user_text", "tool_call", "assistant_text",
    ]);
    expect(userTexts(h)).toEqual(["q1", "q2", "q3"]);
  });

  it("openers of units older than the window ride leading skeleton frames, then the window's interleaved stream — one pass, correct final order", async () => {
    // The server's tail-of-one shape over three units: q1, q2 as leading skeleton
    // rows (units older than the window), then unit 3's opener interleaved with its
    // interior.
    const u = [1, 2, 3].map((n) => ({
      prompt: at(userText(`q${n}`), T(n - 1, "0")),
      reply: at(assistantText(`a${n}`), T(n - 1, "6")),
    }));
    const h = createFramesHarness([
      {
        frames: [
          pageFrame(),
          { type: "skeleton", cursor: "0:0", messages: [u[0]!.prompt, u[1]!.prompt] },
          { type: "meat", cursor: "0:0", messages: [u[2]!.prompt, u[2]!.reply] },
        ],
      },
    ]);
    await h.controller.load();
    expect(h.errors.filter((e) => e !== null)).toEqual([]);
    expect(kinds(h)).toEqual(["user_text", "user_text", "user_text", "assistant_text"]);
    expect(userTexts(h)).toEqual(["q1", "q2", "q3"]);
  });

  it("the skeleton fixes every row's position first — prompts and inserted kinds together — and meat fills with zero row movement", async () => {
    // One transcript: a prompt, a steering chip inside the running Task, the Task's tool
    // work, then a second prompt. The skeleton carries all four rows; the meat carries
    // the tool work and the reply.
    const prompt1 = at(userText("first question"), T(0, "0"));
    const steering = at(userText(userSteeringText("go deeper")), T(0, "2"));
    const call = at(toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" }), T(0, "4"));
    const output = at(toolCallOutput({ output: "done", toolCallId: "t1" }), T(0, "6"));
    const reply = at(assistantText("all done"), T(0, "8"));
    const prompt2 = at(userText("second question"), T(1, "0"));
    const all = [prompt1, steering, call, output, reply, prompt2];

    const skeleton: MessagesHistoryFrame = {
      type: "skeleton",
      cursor: "0:0",
      messages: [prompt1, steering, prompt2],
    };
    const meat1: MessagesHistoryFrame = { type: "meat", cursor: "0:0", messages: [call, output] };
    const meat2: MessagesHistoryFrame = { type: "meat", cursor: "0:0", messages: [reply] };

    const h = createFramesHarness([{ frames: [pageFrame(), skeleton, meat1, meat2] }]);
    const p = h.controller.load();
    await p;
    expect(h.errors.filter((e) => e !== null)).toEqual([]);
    // The rows exist in transcript order; the steering chip's row position was fixed by
    // the skeleton and the meat fill never re-inserted it.
    expect(kinds(h)).toEqual(["user_text", "user_steering", "user_text", "tool_call", "assistant_text"]);
    expect(userTexts(h)).toContain("first question");
    expect(userTexts(h)).toContain("second question");
  });

  it("a resumed read replays frames the client already holds; the dedup drops them and nothing doubles", async () => {
    const prompt1 = at(userText("only question"), T(0, "0"));
    const reply = at(assistantText("the answer"), T(0, "4"));
    const skeleton: MessagesHistoryFrame = {
      type: "skeleton",
      cursor: "0:0",
      messages: [prompt1],
    };
    const meat: MessagesHistoryFrame = { type: "meat", cursor: "0:0", messages: [reply] };

    // First read: skeleton + meat arrive; the stream is interrupted before a second
    // meat frame. Re-entry replays the same envelope and frames.
    const h = createFramesHarness([
      { frames: [pageFrame(), skeleton, meat] },
      { frames: [pageFrame(), skeleton, meat] },
    ]);
    await h.controller.load();
    // Re-entry: a fresh model rebuilds from the replayed frames; the dedup drops the
    // already-held envelope rows so nothing doubles.
    await h.controller.retry();
    expect(kinds(h)).toEqual(["user_text", "assistant_text"]);
  });
});
