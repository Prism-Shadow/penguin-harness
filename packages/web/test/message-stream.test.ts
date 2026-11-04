// @vitest-environment jsdom
/**
 * MessageStream hands the links in its Markdown the conversation's Workspace and file opener
 * (react-dom/server static markup; the one press below is driven in a live DOM). Static markup
 * carries no handlers, so replyLinkBehavior is wrapped rather than replaced: every call still
 * returns the real behaviour, and the test keeps what the link adapter spread onto each rendered
 * anchor in order to click it.
 * It also draws a run-ending LLM failure as its error line. The line a run ended on — that line,
 * the marker of a run the user stopped, or a retry ladder that gave up — offers Retry while it is
 * the stream's last item and no Task runs.
 *
 * A model request that failed:
 * - Given each state of a retry ladder (waiting, going out, sent, given up) and a fatal error,
 *   it is one notice line with its presses after it — Retry now and Stop retrying while it waits,
 *   Retry on the last line, and Details on every one — and no "?" anywhere; the provider's own
 *   words are not on the line.
 * - Given Details pressed, the page is handed the failure: the provider's words, the attempts so
 *   far and the model the request went to.
 *
 * Older history above the transcript:
 * - Given the previous window failed to load, the top says so on a notice line with a Retry, the
 *   error in it.
 * - Given the window is being loaded again, the failure and its Retry are gone (the transfer
 *   line takes the row; its own words are history-loading's).
 * - Given a Retry pressed while no load can start (the stream is rebuilding after a reconnect, so
 *   the failure stays as it was), Retry must not stay disabled: the next press asks again.
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
import type {
  A2uiActions,
  OlderHistoryControls,
  StreamRenderContext,
} from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/amsp/stream-model";
import type { LinkBehavior } from "../src/lib/reply-link";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { LocaleProvider } from "../src/state/locale";
import { button, click, mount, unmountAll } from "./helpers/dom";
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
/** The names of every rendered button: its label, or its words with the tags dropped. */
const pressNames = (html: string) =>
  [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(
    (m) => /aria-label="([^"]*)"/.exec(m[1]!)?.[1] ?? m[2]!.replace(/<[^>]*>/g, ""),
  );

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
  const offersRetry = (html: string) => pressNames(html).includes(S.chat.retryRun);
  // A Retry run's reply lands right after the line: the held input has been sent again.
  const reply: ChatItem = { kind: "assistant_text", id: 2, text: "Done.", streaming: false };
  const gaveUp: ChatItem = {
    kind: "reconnect",
    id: 1,
    status: "retryable",
    attempt: 6,
    retrying: false,
    gaveUp: true,
    errorCode: "network",
    errorMessage: "503 upstream overloaded",
  };

  it.each<[string, ChatItem]>([
    ["a failed run's banner", { kind: "llm_error", id: 1, errorMessage: "400 Bad Request" }],
    ["a stopped run's marker", { kind: "abort", id: 1, errorCode: "user_abort" }],
    ["a retry ladder that gave up", gaveUp],
  ])("%s offers Retry as the last line while no Task runs, and not otherwise", (_, ended) => {
    expect(offersRetry(stream([ended]))).toBe(true);
    expect(offersRetry(stream([ended, reply]))).toBe(false);
    expect(offersRetry(stream([ended], true))).toBe(false);
  });

  const t = S.chat.requestRetry;
  const ladder = (over: Partial<Extract<ChatItem, { kind: "reconnect" }>>): ChatItem => ({
    ...(gaveUp as Extract<ChatItem, { kind: "reconnect" }>),
    attempt: 2,
    gaveUp: false,
    ...over,
  });
  const failures = (items: ChatItem[]) =>
    renderToStaticMarkup(
      createElement(MessageStream, {
        items,
        version: 1,
        ctx: {
          ...ctx,
          onRetry: async () => {},
          onRetryNow: () => {},
          onGiveUp: () => {},
          onShowFailure: () => {},
        },
        onAddExcerpt: () => {},
      }),
    );

  it.each<[string, ChatItem, string[]]>([
    [
      "a ladder waiting for its next attempt",
      ladder({ plannedDelayMs: 30_000, arrivedAtMs: Date.now() }),
      [t.retryNow, t.stop, S.chat.failureReport.open],
    ],
    ["a ladder sending its next attempt", ladder({}), [S.chat.failureReport.open]],
    ["a ladder whose attempt went out", ladder({ retrying: true }), [S.chat.failureReport.open]],
    ["a ladder that gave up", gaveUp, [S.chat.retryRun, S.chat.failureReport.open]],
    [
      "a fatal error",
      { kind: "llm_error", id: 1, errorCode: "auth", errorMessage: "401 invalid x-api-key" },
      [S.chat.retryRun, S.chat.failureReport.open],
    ],
  ])(
    "%s is one notice line with its presses and Details, no ?, and no provider words",
    (_, item, presses) => {
      const html = failures([item]);
      expect(pressNames(html)).toEqual(presses);
      expect(html).not.toContain("upstream overloaded");
      expect(html).not.toContain("invalid x-api-key");
    },
  );

  it("Details hands the page the failure: the provider's words, the attempts and the model", async () => {
    const onShowFailure = vi.fn();
    await mount(
      createElement(MessageStream, {
        items: [{ ...gaveUp, model: { provider: "custom", modelId: "claude-4-8" } } as ChatItem],
        version: 1,
        ctx: { ...ctx, onShowFailure },
        onAddExcerpt: () => {},
      }),
    );
    await click(button(S.chat.failureReport.open));
    expect(onShowFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        phase: "gaveUp",
        attempt: 6,
        errorCode: "network",
        message: "503 upstream overloaded",
        model: { provider: "custom", modelId: "claude-4-8" },
      }),
    );
    await unmountAll();
  });
});

describe("MessageStream older history", () => {
  const ctx: StreamRenderContext = {
    pendingApprovals: new Map(),
    onApprove: async () => {},
    origin: [],
    taskRunning: false,
  };
  const reply: ChatItem = { kind: "assistant_text", id: 1, text: "Done.", streaming: false };
  const top = (over: Partial<OlderHistoryControls>) =>
    renderToStaticMarkup(
      createElement(MessageStream, {
        items: [reply],
        version: 1,
        ctx,
        onAddExcerpt: () => {},
        older: {
          hasMore: true,
          loading: false,
          error: null,
          prependedCount: 0,
          onLoad: () => {},
          ...over,
        },
      }),
    );

  it("a window that failed to load is said at the top on a notice line with a Retry, its error in it", () => {
    const html = top({ error: "socket closed: ECONNRESET" });
    expect(html).toContain(S.chat.loadEarlierFailed("socket closed: ECONNRESET"));
    expect(pressNames(html)).toEqual([S.common.retry]);
  });

  it("while the window loads again, the failure and its Retry are gone", () => {
    const html = top({ loading: true, error: "socket closed: ECONNRESET" });
    expect(html).not.toContain("ECONNRESET");
    expect(pressNames(html)).not.toContain(S.common.retry);
  });

  it("a Retry that started no load stays pressable, and the next press asks again", async () => {
    // A press that starts nothing: the failure, and so the row's state, stay as they were.
    const onLoad = vi.fn();
    await mount(
      createElement(MessageStream, {
        items: [reply],
        version: 1,
        ctx,
        onAddExcerpt: () => {},
        older: { hasMore: true, loading: false, error: "socket closed", prependedCount: 0, onLoad },
      }),
    );
    await click(button(S.common.retry));
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(button(S.common.retry).disabled).toBe(false);
    await click(button(S.common.retry));
    expect(onLoad).toHaveBeenCalledTimes(2);
    await unmountAll();
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
