/**
 * The pictures in a conversation, where the browser fetches them from (react-dom/server static
 * markup, node env, no DOM). A windowed history page carries each Trace image by reference
 * (`/api/sessions/<id>/trace-image?…`), and the browser follows an `<img src>` itself, with no
 * request for the fetch wrapper's routing rule to act on.
 *
 * - Given a Session that lives on another machine, an image the page names by reference is
 *   fetched from that machine, and only as it nears the viewport.
 * - Given a Session on this server, the reference is fetched here, as written.
 * - Given a steering message's image on a machine's Session, it is fetched from that machine.
 * - An image that arrived inline (live, or a subagent's) renders from its own bytes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageStream } from "../src/features/chat/message-stream";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/omni/stream-model";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";
import { LocaleProvider } from "../src/state/locale";
import { stubLocalStorage } from "./helpers/storage";

beforeEach(() => {
  stubLocalStorage().setItem("penguin.lang", "en");
});
afterEach(() => forgetSessionMachines());

const ctx: StreamRenderContext = {
  pendingApprovals: new Map(),
  onApprove: async () => {},
  origin: [],
  taskRunning: false,
};

/** The `<img>` tags a stream of these items renders. */
function imgTags(items: ChatItem[]): string[] {
  const html = renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(MessageStream, { items, version: 1, ctx, onAddExcerpt: () => {} }),
    ),
  );
  return html.match(/<img\b[^>]*>/g) ?? [];
}

const ref = (sessionId: string) => `/api/sessions/${sessionId}/trace-image?file=2&amp;ordinal=8`;

describe("transcript images", () => {
  it("a referenced image of a Session on another machine is fetched from that machine, lazily", () => {
    rememberSessionMachine("s-remote", "M1");
    const tags = imgTags([
      {
        kind: "user_image",
        id: 1,
        imageUrl: "/api/sessions/s-remote/trace-image?file=2&ordinal=8",
      },
    ]);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain(`src="/server/M1${ref("s-remote")}"`);
    expect(tags[0]).toContain('loading="lazy"');
  });

  it("a referenced image of a Session on this server is fetched here, as written", () => {
    const tags = imgTags([
      { kind: "user_image", id: 1, imageUrl: "/api/sessions/s-local/trace-image?file=2&ordinal=8" },
    ]);
    expect(tags[0]).toContain(`src="${ref("s-local")}"`);
  });

  it("a steering message's image on a machine's Session is fetched from that machine", () => {
    rememberSessionMachine("s-remote", "M1");
    const tags = imgTags([
      { kind: "user_text", id: 1, text: "start" },
      {
        kind: "user_steering",
        id: 2,
        text: "look at this too",
        images: ["/api/sessions/s-remote/trace-image?file=2&ordinal=8"],
      },
    ]);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain(`src="/server/M1${ref("s-remote")}"`);
  });

  it("an image that arrived inline renders from its own bytes", () => {
    rememberSessionMachine("s-remote", "M1");
    const bytes = "data:image/png;base64,iVBORw0KGgo=";
    const tags = imgTags([{ kind: "user_image", id: 1, imageUrl: bytes }]);
    expect(tags[0]).toContain(`src="${bytes}"`);
  });
});
