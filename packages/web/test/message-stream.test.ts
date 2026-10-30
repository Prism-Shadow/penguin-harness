/**
 * MessageStream hands the links in its Markdown the conversation's Workspace and file opener
 * (react-dom/server static markup, node env, no DOM). Static markup carries no handlers, so
 * replyLinkBehavior is wrapped rather than replaced: every call still returns the real behaviour,
 * and the test keeps what the link adapter spread onto each rendered anchor in order to click it.
 * It also draws a run-ending LLM failure as its error banner, with a hint under a context overflow.
 * The line a run ended on — that banner, or the marker of a run the user stopped — offers Retry
 * while it is the stream's last item and no Task runs.
 *
 * What a prompt carried is drawn as one message, the way the composer showed it:
 * - Given a prompt's text and the image items right behind it, the images sit above the text in
 *   the same message (one outline anchor), not as messages of their own.
 * - Given a prompt with no text, its images make one message.
 * - Given files attached to a prompt, each file is named in its own tile above the text.
 * - Given a prompt that follows a reply, its images do not join the earlier prompt.
 *
 * A reply's form shows what answered it:
 * - Given the form as the open question, it takes input and starts at its defaults.
 * - Given the person's message with the filled text after it, the form is read-only and shows
 *   those answers.
 * - Given the same transcript read back from history after a reload, under the other interface
 *   language, it shows the same answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageStream } from "../src/features/chat/message-stream";
import type { A2uiActions, StreamRenderContext } from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/amsp/stream-model";
import type { LinkBehavior } from "../src/lib/reply-link";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { LocaleProvider } from "../src/state/locale";
import { stubLocalStorage } from "./helpers/storage";

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

describe("MessageStream prompts with attachments", () => {
  const ctx: StreamRenderContext = {
    pendingApprovals: new Map(),
    onApprove: async () => {},
    origin: [],
    taskRunning: false,
  };
  // A message the person sent carries its time in the reader's locale.
  beforeEach(() => {
    stubLocalStorage().setItem("penguin.lang", "en");
  });
  afterEach(() => {
    setActiveStrings(zh);
    vi.unstubAllGlobals();
  });
  const stream = (items: ChatItem[]) =>
    renderToStaticMarkup(
      createElement(
        LocaleProvider,
        null,
        createElement(MessageStream, { items, version: 1, ctx, onAddExcerpt: () => {} }),
      ),
    );
  const anchorCount = (html: string) => html.match(/data-outline-anchor=/g)?.length ?? 0;
  const imageCount = (html: string) => html.match(/<img\b/g)?.length ?? 0;
  const image = (id: number, imageUrl: string): ChatItem => ({ kind: "user_image", id, imageUrl });
  const DIR = "/home/u/.penguin/data/p1/agents/a1/scratchpad/s1";

  it("a prompt's text and the images behind it are one message, images above the text", () => {
    const html = stream([
      { kind: "user_text", id: 1, text: "Why is this red?" },
      image(2, "data:image/png;base64,AAAA"),
      image(3, "data:image/png;base64,BBBB"),
    ]);
    expect(anchorCount(html)).toBe(1);
    expect(imageCount(html)).toBe(2);
    expect(html.indexOf("BBBB")).toBeLessThan(html.indexOf("Why is this red?"));
  });

  it("a prompt with only images is one message", () => {
    const html = stream([
      image(1, "data:image/png;base64,AAAA"),
      image(2, "data:image/png;base64,BBBB"),
    ]);
    expect(anchorCount(html)).toBe(1);
    expect(imageCount(html)).toBe(2);
  });

  it("each attached file is named above the text", () => {
    const html = stream([
      {
        kind: "user_text",
        id: 1,
        text: `Review these\n\n[attached file: ${DIR}/report.pdf]\n[attached file: ${DIR}/rows.csv]`,
      },
    ]);
    for (const name of ["report.pdf", "rows.csv"]) {
      expect(html).toContain(`>${name}</span>`);
      expect(html.indexOf(name)).toBeLessThan(html.indexOf("Review these"));
    }
    expect(html).not.toContain(DIR);
  });

  it("images after a reply belong to the next prompt, not the one before", () => {
    const html = stream([
      { kind: "user_text", id: 1, text: "First" },
      { kind: "assistant_text", id: 2, text: "Answer.", streaming: false },
      image(3, "data:image/png;base64,AAAA"),
    ]);
    expect(anchorCount(html)).toBe(2);
    expect(html.indexOf("AAAA")).toBeGreaterThan(html.indexOf("Answer."));
  });
});

describe("MessageStream answered A2UI blocks", () => {
  const FORM = {
    type: "form",
    title: "Deployment",
    fields: [
      { id: "service", label: "Service name", kind: "text", required: true },
      {
        id: "replicas",
        label: "Replicas",
        kind: "number",
        min: 1,
        max: 10,
        unit: "pods",
        default: 2,
      },
      { id: "notify", label: "Notify me", kind: "switch", default: true },
    ],
  };
  const question = `Give the details in one go:\n\n\`\`\`a2ui\n${JSON.stringify(FORM)}\n\`\`\``;
  // What the form's fill button put in the composer, as the person sent it.
  const answer = "Service name: billing-api\nReplicas: 5 pods\nNotify me: No";
  afterEach(() => {
    setActiveStrings(zh);
    vi.unstubAllGlobals();
  });
  /** The stream as the chat page draws it, in the interface language `lang`. */
  const stream = (items: ChatItem[], lang: A2uiActions["lang"] = "en") => {
    stubLocalStorage().setItem("penguin.lang", lang);
    return renderToStaticMarkup(
      createElement(
        LocaleProvider,
        null,
        createElement(MessageStream, {
          items,
          version: 1,
          ctx: {
            pendingApprovals: new Map(),
            onApprove: async () => {},
            origin: [],
            taskRunning: false,
            a2uiActions: { interactive: true, fill: () => {}, lang },
          },
          onAddExcerpt: () => {},
        }),
      ),
    );
  };
  /** The opening tags of `name` carrying every one of `attrs`. */
  const tags = (html: string, name: string, ...attrs: string[]) =>
    (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
      attrs.every((attr) => tag.includes(attr)),
    );
  const transcript = (first: number): ChatItem[] => [
    { kind: "user_text", id: first, text: "Deploy the billing service" },
    { kind: "assistant_text", id: first + 1, text: question, streaming: false },
    { kind: "user_text", id: first + 2, text: answer },
  ];

  it("the open question takes input and starts at its defaults", () => {
    const html = stream(transcript(1).slice(0, 2));
    expect(tags(html, "button", 'type="submit"')).toHaveLength(1);
    expect(tags(html, "input", 'value="2"')).toHaveLength(1);
    expect(tags(html, "button", 'role="switch"', 'aria-checked="true"')).toHaveLength(1);
  });

  it("once answered, the form is read-only and shows the answers that were sent", () => {
    const html = stream(transcript(1));
    expect(tags(html, "button", 'type="submit"')).toHaveLength(0);
    expect(tags(html, "input", 'value="billing-api"', 'disabled=""')).toHaveLength(1);
    expect(tags(html, "input", 'value="5"')).toHaveLength(1);
    expect(tags(html, "input", 'value="2"')).toHaveLength(0);
    expect(tags(html, "button", 'role="switch"', 'aria-checked="false"')).toHaveLength(1);
  });

  it("after a reload, read back from history under the other language, shows the same answers", () => {
    // History windows arrive as new items with their own ids; the interface is in Chinese now.
    const html = stream(transcript(-40), "zh");
    expect(tags(html, "input", 'value="billing-api"', 'disabled=""')).toHaveLength(1);
    expect(tags(html, "input", 'value="5"')).toHaveLength(1);
    expect(tags(html, "button", 'role="switch"', 'aria-checked="false"')).toHaveLength(1);
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
import { assistantText, toolCall, toolCallOutput, userText } from "@prismshadow/amsp";
import type { AmspRecord } from "@prismshadow/amsp";
import { userSteeringText } from "@prismshadow/amsp/markers";
import { createStreamController } from "../src/lib/amsp/stream-controller";
import type { MessagesPageQuery, StreamController } from "../src/lib/amsp/stream-controller";
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

function at<M extends AmspRecord>(msg: M, ts: string): M {
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
  it("the skeleton fixes every row's position first — prompts and inserted kinds together — and meat fills with zero row movement", async () => {
    // One transcript: a prompt, a steering chip inside the running Task, the Task's tool
    // work, then a second prompt. The skeleton carries all four rows; the meat carries
    // the tool work and the reply.
    const prompt1 = at(userText("first question"), T(0, "0"));
    const steering = at(userText(userSteeringText("go deeper")), T(0, "2"));
    const call = at(toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" }), T(0, "4"));
    const output = at(toolCallOutput({ output: "done", toolCallId: "t1", status: "completed" }), T(0, "6"));
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
