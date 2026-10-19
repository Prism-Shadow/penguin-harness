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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageStream } from "../src/features/chat/message-stream";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/omni/stream-model";
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
