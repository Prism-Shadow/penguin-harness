/**
 * Md (chat markdown) rendering contract, via react-dom/server static markup (node env, no DOM):
 * - outside a conversation every link — explicit [text](url), bare autolinked URL (remark-gfm),
 *   relative or #anchor — opens in a new tab: target="_blank" + rel="noreferrer";
 * - inside one (WorkspaceLinksProvider, as MessageStream renders it) only an external link does:
 *   a link to a Workspace file, an #anchor and a relative href with nowhere to go render without
 *   a target, because a relative href resolves against the SPA's own route. What their clicks do
 *   is covered in reply-link.test.ts — static markup carries no handlers;
 * - fenced code still routes through the module-scope pre override into CodeBlock (its chrome
 *   renders; Shiki only loads in an effect, which static markup never runs).
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Md, WorkspaceLinksProvider } from "../src/features/chat/md";
import { replyLinkBehavior, resolveReplyLink } from "../src/lib/reply-link";

const render = (text: string, streaming = false) =>
  renderToStaticMarkup(createElement(Md, { text, streaming }));

const WS = "/home/user/workspaces/tmp-1";

/**
 * Renders inside a conversation's Workspace, the way MessageStream wraps its items. `onOpenFile`
 * is passed through as given — undefined included — since that is how a stream with no file
 * opener wired renders.
 */
const renderWithOpener = (
  text: string,
  onOpenFile: ((path: string) => void) | undefined,
  streaming = false,
) =>
  renderToStaticMarkup(
    createElement(WorkspaceLinksProvider, {
      workspace: WS,
      onOpenFile,
      children: createElement(Md, { text, streaming }),
    }),
  );

const renderInConversation = (text: string, streaming = false) =>
  renderWithOpener(text, () => undefined, streaming);

/** All rendered <a ...> opening tags. */
const anchors = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

/** The href attribute of a rendered opening tag, as react-dom escaped it. */
const hrefOf = (tag: string | undefined) => /href="([^"]*)"/.exec(tag ?? "")?.[1];

const expectNewTab = (tag: string | undefined) => {
  expect(tag).toContain('target="_blank"');
  expect(tag).toContain('rel="noreferrer"');
};

const expectInPlace = (tag: string | undefined) => {
  expect(tag).not.toContain("target=");
  expect(tag).not.toContain("rel=");
};

describe("Md links", () => {
  it("explicit markdown links open in a new tab", () => {
    const html = render("See [the docs](https://example.com/docs) for details.");
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="https://example.com/docs"');
    expectNewTab(tags[0]);
    expect(html).toContain(">the docs</a>");
  });

  it("bare autolinked URLs in CJK prose open in a new tab", () => {
    const html = render("前往 https://example.com/a/very/long/path 查看结果。");
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="https://example.com/a/very/long/path"');
    expectNewTab(tags[0]);
  });

  it('preserves the markdown link title from [text](url "title")', () => {
    const html = render('Read [docs](https://example.com "API docs") first.');
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="https://example.com"');
    expect(tags[0]).toContain('title="API docs"');
    expectNewTab(tags[0]);
  });

  it("outside a conversation, relative and #anchor hrefs also open in a new tab (never SPA-navigate)", () => {
    const html = render("[rel](./file.md) and [frag](#section)");
    const tags = anchors(html);
    expect(tags).toHaveLength(2);
    for (const tag of tags) expectNewTab(tag);
  });

  it("applies in both streaming and settled component maps", () => {
    for (const streaming of [true, false]) {
      const tags = anchors(render("[x](https://example.com/)", streaming));
      expect(tags).toHaveLength(1);
      expectNewTab(tags[0]);
    }
  });
});

describe("Md links inside a conversation", () => {
  it("a reply's relative link to a Workspace file renders in place, and its click opens the file", () => {
    // The reported reply, verbatim.
    const html = renderInConversation(
      "已创建： [pelican-bike.html](pelican-bike.html)\n\n用浏览器打开即可观看：",
    );
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(hrefOf(tags[0])).toBe("pelican-bike.html");
    expectInPlace(tags[0]);
    // Static markup drops handlers, so the click goes through the behaviour MdLink spreads onto
    // this anchor, fed the href the renderer actually produced.
    const openFile = vi.fn();
    const preventDefault = vi.fn();
    replyLinkBehavior(hrefOf(tags[0]), { workspace: WS, openFile }).onClick!({
      preventDefault,
    } as unknown as MouseEvent<HTMLAnchorElement>);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledExactlyOnceWith("pelican-bike.html");
  });

  it("a CJK file name reaches the adapter percent-encoded and still resolves to the name on disk", () => {
    const tags = anchors(renderInConversation("[预览](./鹈鹕.html)"));
    expect(tags).toHaveLength(1);
    expectInPlace(tags[0]);
    expect(resolveReplyLink(hrefOf(tags[0]), WS)).toEqual({ kind: "file", path: "鹈鹕.html" });
  });

  it("external links, bare URLs included, still open in a new tab", () => {
    const tags = anchors(
      renderInConversation("[docs](https://example.com/docs) and https://example.com/raw"),
    );
    expect(tags).toHaveLength(2);
    for (const tag of tags) expectNewTab(tag);
  });

  it("an #anchor, a footnote reference and an href with nowhere to go render without a target", () => {
    const html = renderInConversation(
      "[frag](#section), [up](../outside.html), [sys](/etc/hosts)[^1]\n\n[^1]: A note.",
    );
    const tags = anchors(html);
    // frag, up, sys, the footnote reference, and the footnote's back-reference.
    expect(tags).toHaveLength(5);
    for (const tag of tags) expectInPlace(tag);
    expect(html).toContain('id="user-content-fn-1"');
  });

  it("a file: URL and a Windows drive-letter path reach the adapter emptied, and stay in place", () => {
    const tags = anchors(
      renderInConversation("[a](file:///home/user/a.html) and [b](C:/Users/me/ws/b.html)"),
    );
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(hrefOf(tag)).toBe("");
      expectInPlace(tag);
    }
  });

  it("applies in both streaming and settled component maps", () => {
    for (const streaming of [true, false]) {
      const tags = anchors(renderInConversation("[x](report.md)", streaming));
      expect(tags).toHaveLength(1);
      expectInPlace(tags[0]);
    }
  });

  it("with no file opener wired, a conversation's links keep the new tab", () => {
    const tags = anchors(renderWithOpener("[x](pelican-bike.html)", undefined));
    expect(tags).toHaveLength(1);
    expectNewTab(tags[0]);
  });
});

describe("Md code blocks", () => {
  it("fenced code still renders through the CodeBlock pre override", () => {
    const html = render("```js\nconst a = 1;\n```");
    expect(html).toContain("code-block"); // CodeBlock chrome wrapper class
    expect(html).toContain("const a = 1;");
  });
});
