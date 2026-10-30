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
import type { ChatItem, ToolCallItem } from "../src/lib/amsp/stream-model";
import type { MessagesPageQuery } from "../src/lib/amsp/stream-controller";
import { createStreamController } from "../src/lib/amsp/stream-controller";
import type { StreamController } from "../src/lib/amsp/stream-controller";
import type { MessagesHistoryFrame } from "../src/api/endpoints";
import { assistantText, toolCall, toolCallOutput, userText } from "@prismshadow/amsp";
import type { AmspRecord, SessionStatus } from "@prismshadow/amsp";
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
 * Streamed history (frames) consumption (the controller's loadFrames path, rendered
 * through the model the same way the page does): a skeleton frame fixes every row's
 * position BEFORE any meat arrives — the inserted kinds (steering chip, context
 * summary, in-task notice) included — and the meat frames only fill the units'
 * interiors: zero row displacement, the collapsed work groups only grow their badge
 * counts. Frames re-entering after an interruption replay already-held messages, and
 * the envelope dedup drops them; a 563 KB single unit arrives across several meat
 * frames with every group intact.
 */
describe("MessageStream frames consumption", () => {
  interface FramesHarness {
    controller: StreamController;
    states: SessionStatus[];
    errors: Array<string | null>;
    pageArgs: Array<MessagesPageQuery | undefined>;
    /** Feed one frames response for the given page query, frame list supplied by the test. */
    serve: (page: MessagesPageQuery | undefined, frames: MessagesHistoryFrame[]) => void;
    reject: (err: Error) => void;
    settle: () => Promise<void>;
  }

  const makeFramesHarness = (): FramesHarness => {
    const states: SessionStatus[] = [];
    const errors: Array<string | null> = [];
    const pageArgs: Array<MessagesPageQuery | undefined> = [];
    const pending: Array<{
      page: MessagesPageQuery | undefined;
      resolve: (r: { serverNowMs: number | null }) => void;
      reject: (e: unknown) => void;
    }> = [];
    const controller = createStreamController({
      sessionId: "s1",
      loadMessages: () => Promise.resolve({ messages: [] }),
      loadMessageFrames: (page, onFrame) =>
        new Promise<{ serverNowMs: number | null }>((resolve, reject) => {
          pageArgs.push(page);
          pending.push({
            page,
            resolve: () => {
              for (const f of served.shift() ?? []) onFrame(f);
              resolve({ serverNowMs: null });
            },
            reject,
          });
        }),
      onTaskState: (s) => states.push(s),
      onLoading: () => {},
      onError: (e) => errors.push(e),
      onModelChange: () => {},
      onPendingChange: () => {},
      now: () => 1_000_000,
    });
    let served: MessagesHistoryFrame[][] = [];
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    return {
      controller,
      states,
      errors,
      pageArgs,
      serve: (page, frames) => {
        served = [frames];
        void controller.load();
        // The load opened the frames request synchronously: hand the frames over now.
        pending.shift()!.resolve({ serverNowMs: null });
      },
      reject: (err) => {
        pending.shift()!.reject(err);
      },
      settle,
    };
  };

  /** A frames response for a whole transcript of two units, the second with a tool group and an inserted notice. */
  const framesOf = (): MessagesHistoryFrame[] => [
    {
      type: "page",
      earlierTurns: 0,
      prior: {
        subagentTokens: 0,
        elapsedMs: 0,
        apiMs: 0,
        toolMs: 0,
        sessionTokens: 0,
        contextTokens: 0,
      },
    },
    {
      type: "skeleton",
      cursor: "0:0",
      messages: [
        userText("q1"),
        userText("q2"),
        userText("[user_steering]\nfaster\n[/user_steering]"),
      ],
    },
    { type: "meat", cursor: "1:2", messages: [assistantText("a1")] },
    {
      type: "meat",
      cursor: "1:6",
      messages: [
        toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" }),
        toolCallOutput({ output: "out", toolCallId: "t1", status: "completed" }),
        userText("Background command finished", "harness"),
        assistantText("a2"),
      ],
    },
  ];

  it("the skeleton fixes every row's position first; meat frames fill with zero row displacement and only badge growth", async () => {
    const h = makeFramesHarness();
    // Serve ONLY the page + skeleton frames first: rows exist before any content.
    h.serve(undefined, [framesOf()[0]!, framesOf()[1]!]);
    await h.settle();
    await h.settle();
    const itemsMid = h.controller.model.items;
    const kindsMid = itemsMid.map((i) => i.kind);
    // All three rows placed: the two prompts and the inserted steering chip.
    expect(kindsMid).toContain("user_text");
    expect(kindsMid).toContain("user_steering");
    expect(kindsMid.length).toBe(3);
    const idsMid = itemsMid.map((i) => i.id);

    // Now the full sequence (a fresh model, as a fresh load is): the meat fills the
    // interiors; the three skeleton rows keep their relative order and positions.
    const h2 = makeFramesHarness();
    h2.serve(undefined, framesOf());
    await h2.settle();
    await h2.settle();
    const itemsFull = h2.controller.model.items;
    const rowsFull = itemsFull.filter((i) => idsMid.includes(i.id));
    expect(rowsFull.map((i) => i.kind)).toEqual(kindsMid);
    // Zero displacement: the same ids appear in the same relative order.
    expect(itemsFull.map((i) => i.id).filter((id) => idsMid.includes(id))).toEqual(idsMid);
    // The meat added exactly the interior items (reply, tool group, notice, reply),
    // appended AFTER the skeleton rows' unit positions.
    expect(itemsFull.length).toBeGreaterThan(3);
    expect(itemsFull.some((i) => i.kind === "tool_call")).toBe(true);
    expect(itemsFull.some((i) => i.kind === "background_notice" || i.kind === "user_text")).toBe(
      true,
    );
  });

  it("cursor re-entry after an interruption: replayed frames dedup and the transcript converges to the uninterrupted sequence", async () => {
    const h = makeFramesHarness();
    // Interrupted stream: page + skeleton + first meat only.
    const all = framesOf();
    h.serve(undefined, [all[0]!, all[1]!, all[2]!]);
    await h.settle();
    await h.settle();
    const firstPassItems = h.controller.model.items.length;

    // Re-entry (a fresh controller, as a retry is): the server replays page + skeleton
    // + the frames the client already held PLUS the continuation.
    const h2 = makeFramesHarness();
    h2.serve(
      {
        kind: "before",
        cursor: (all[2] as Extract<MessagesHistoryFrame, { type: "meat" }>).cursor,
        limit: 20,
      },
      all,
    );
    await h2.settle();
    await h2.settle();
    // Converged: same transcript as an uninterrupted whole, nothing duplicated.
    const h3 = makeFramesHarness();
    h3.serve(undefined, all);
    await h3.settle();
    await h3.settle();
    expect(h2.controller.model.items.length).toBe(h3.controller.model.items.length);
    expect(h2.controller.model.items.length).toBeGreaterThanOrEqual(firstPassItems);
    expect(h2.errors.at(-1) ?? null).toBeNull();
  });

  it("a 563 KB single unit arrives across several meat frames with every group intact", async () => {
    // One unit: a prompt followed by 74 large tool groups; the frame sender (the
    // server's planMeatFrames) cuts them into 64 KB frames; the consumer's model must
    // hold all 74 cards no matter how many frames carried them.
    const groups: AmspRecord[] = [];
    for (let n = 1; n <= 74; n++) {
      groups.push(
        toolCall({
          name: "exec",
          arguments: JSON.stringify({ cmd: `step ${n}`, data: "x".repeat(7_000) }),
          toolCallId: `t${n}`,
        }),
      );
      groups.push(
        toolCallOutput({
          output: `out ${n} ${"y".repeat(500)}`,
          toolCallId: `t${n}`,
          status: "completed",
        }),
      );
    }
    // The server-side planner: same code the route uses.
    const { frameCutIndexes, planMeatFrames } = (await import(
      // The server package's compiled source is not a web dependency; these two pure
      // functions are read from the server workspace source directly (nothing
      // server-runtime enters the browser bundle from a test).
      "../../server/src/services/message-window.js"
    )) as typeof import("../../server/src/services/message-window.js");
    const byteOf = (m: AmspRecord): number => JSON.stringify(m).length + 1;
    const plans = planMeatFrames(byteOf, groups, frameCutIndexes(groups));
    expect(plans.length).toBeGreaterThan(1);
    const frames: MessagesHistoryFrame[] = [
      {
        type: "page",
        earlierTurns: 0,
        prior: {
          subagentTokens: 0,
          elapsedMs: 0,
          apiMs: 0,
          toolMs: 0,
          sessionTokens: 0,
          contextTokens: 0,
        },
      },
      { type: "skeleton", cursor: "0:0", messages: [userText("heavy")] },
      ...plans.map(({ from, to }, k) => ({
        type: "meat" as const,
        cursor: `${k}:${from}`,
        messages: groups.slice(from, to),
      })),
    ];
    const h = makeFramesHarness();
    h.serve(undefined, frames);
    await h.settle();
    await h.settle();
    const calls = h.controller.model.items.filter((i) => i.kind === "tool_call");
    expect(calls.length).toBe(74);
    const outputs = (calls as ToolCallItem[]).filter((c) => c.outputComplete);
    expect(outputs.length).toBe(74);
  });
});
