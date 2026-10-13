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
