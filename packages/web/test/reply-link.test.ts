/**
 * reply-link.ts: how an href in a conversation's Markdown is sorted (resolveReplyLink) and what a
 * click on each kind does (replyLinkBehavior). The hrefs here are the shapes the renderer
 * actually hands the link adapter — micromark percent-encodes non-ASCII, and react-markdown
 * empties any scheme it does not trust — which md.test.ts pins through the real pipeline.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent } from "react";
import { NEW_TAB, replyLinkBehavior, resolveReplyLink } from "../src/lib/reply-link";

const WS = "/home/user/workspaces/tmp-1";

describe("resolveReplyLink", () => {
  it("a relative href is a Workspace file", () => {
    expect(resolveReplyLink("pelican-bike.html", WS)).toEqual({
      kind: "file",
      path: "pelican-bike.html",
    });
    expect(resolveReplyLink("sub/dir/a.txt", WS)).toEqual({ kind: "file", path: "sub/dir/a.txt" });
  });

  it("a leading ./ and inner . segments drop", () => {
    expect(resolveReplyLink("./pelican-bike.html", WS)).toEqual({
      kind: "file",
      path: "pelican-bike.html",
    });
    expect(resolveReplyLink("./sub/./a.md", WS)).toEqual({ kind: "file", path: "sub/a.md" });
  });

  it("percent-encoding is decoded, so CJK and spaced names resolve to the name on disk", () => {
    expect(resolveReplyLink("%E9%B9%88%E9%B9%95.html", WS)).toEqual({
      kind: "file",
      path: "鹈鹕.html",
    });
    expect(resolveReplyLink("docs/%E6%8A%A5%E5%91%8A%20v2.md", WS)).toEqual({
      kind: "file",
      path: "docs/报告 v2.md",
    });
  });

  it("a query or hash is ignored for the lookup", () => {
    expect(resolveReplyLink("report.html?v=2#top", WS)).toEqual({
      kind: "file",
      path: "report.html",
    });
    expect(resolveReplyLink("report.html#section", WS)).toEqual({
      kind: "file",
      path: "report.html",
    });
    // Nothing left once the query is gone.
    expect(resolveReplyLink("?v=2", WS)).toEqual({ kind: "none" });
  });

  it("a .. that climbs out of the Workspace goes nowhere; one that stays inside pops", () => {
    expect(resolveReplyLink("../secret.txt", WS)).toEqual({ kind: "none" });
    expect(resolveReplyLink("a/../../b.txt", WS)).toEqual({ kind: "none" });
    expect(resolveReplyLink("%2E%2E/secret.txt", WS)).toEqual({ kind: "none" });
    expect(resolveReplyLink("a/../b.txt", WS)).toEqual({ kind: "file", path: "b.txt" });
  });

  it("an absolute path counts only inside the Session's Workspace", () => {
    expect(resolveReplyLink(`${WS}/out/pelican-bike.html`, WS)).toEqual({
      kind: "file",
      path: "out/pelican-bike.html",
    });
    expect(resolveReplyLink("/etc/hosts", WS)).toEqual({ kind: "none" });
    expect(resolveReplyLink(`${WS}-other/a.txt`, WS)).toEqual({ kind: "none" });
    expect(resolveReplyLink(WS, WS)).toEqual({ kind: "none" });
    // No Workspace known: an absolute path cannot be placed, a relative one still can.
    expect(resolveReplyLink(`${WS}/a.txt`, null)).toEqual({ kind: "none" });
    expect(resolveReplyLink("a.txt", null)).toEqual({ kind: "file", path: "a.txt" });
  });

  it("a Windows Workspace matches its paths with either separator", () => {
    const winWs = "C:\\Users\\me\\ws";
    expect(resolveReplyLink("sub%5Ca.txt", winWs)).toEqual({ kind: "file", path: "sub/a.txt" });
    expect(resolveReplyLink("./sub/a.txt", winWs)).toEqual({ kind: "file", path: "sub/a.txt" });
  });

  it("a scheme or a protocol-relative href is external", () => {
    for (const href of [
      "https://example.com/pelican-bike.html",
      "HTTP://EXAMPLE.COM",
      "mailto:someone@example.com",
      "//cdn.example.com/app.js",
    ]) {
      expect(resolveReplyLink(href, WS)).toEqual({ kind: "external" });
    }
  });

  it("#id is an in-page anchor, decoded; a bare # goes nowhere", () => {
    expect(resolveReplyLink("#user-content-fn-1", WS)).toEqual({
      kind: "anchor",
      id: "user-content-fn-1",
    });
    expect(resolveReplyLink("#%E7%BB%93%E8%AE%BA", WS)).toEqual({ kind: "anchor", id: "结论" });
    expect(resolveReplyLink("#", WS)).toEqual({ kind: "none" });
  });

  it("an empty href (the renderer's replacement for an untrusted scheme), ~ paths and bad escapes go nowhere", () => {
    expect(resolveReplyLink("", WS)).toEqual({ kind: "none" });
    expect(resolveReplyLink(undefined, WS)).toEqual({ kind: "none" });
    expect(resolveReplyLink("~/notes.md", WS)).toEqual({ kind: "none" });
    expect(resolveReplyLink("%E9%B9", WS)).toEqual({ kind: "none" });
  });
});

/** A click event carrying just what the handlers read. */
function click(currentTarget: unknown = { parentElement: null }) {
  return {
    preventDefault: vi.fn(),
    currentTarget,
  } as unknown as MouseEvent<HTMLAnchorElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("replyLinkBehavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a Workspace file opens in the Files panel instead of a new tab", () => {
    const openFile = vi.fn();
    const behavior = replyLinkBehavior("./pelican-bike.html", { workspace: WS, openFile });
    expect(behavior.target).toBeUndefined();
    expect(behavior.rel).toBeUndefined();
    const event = click();
    behavior.onClick!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledExactlyOnceWith("pelican-bike.html");
  });

  it("a file that may not exist still opens the panel on its path", () => {
    // No existence check on the way: the panel's own state reports a missing file.
    const openFile = vi.fn();
    replyLinkBehavior("missing/nowhere.html", { workspace: WS, openFile }).onClick!(click());
    expect(openFile).toHaveBeenCalledExactlyOnceWith("missing/nowhere.html");
  });

  it("an external link keeps the new tab and no click handler", () => {
    const openFile = vi.fn();
    const behavior = replyLinkBehavior("https://example.com", { workspace: WS, openFile });
    expect(behavior).toBe(NEW_TAB);
    expect(behavior.onClick).toBeUndefined();
  });

  it("an href with nowhere to go neither navigates nor opens anything", () => {
    const openFile = vi.fn();
    for (const href of ["../secret.txt", "/etc/hosts", ""]) {
      const behavior = replyLinkBehavior(href, { workspace: WS, openFile });
      expect(behavior.target).toBeUndefined();
      const event = click();
      behavior.onClick!(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(openFile).not.toHaveBeenCalled();
  });

  it("an anchor scrolls to the nearest element with that id, without navigating", () => {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    const openFile = vi.fn();
    // Two replies in one transcript, each with its own footnote 1: the one in the clicked
    // link's reply is the target, not the first in the document.
    const inReply = { scrollIntoView: vi.fn() };
    const elsewhere = { scrollIntoView: vi.fn() };
    const transcript = {
      parentElement: null,
      querySelector: (selector: string) => (selector === "#user-content-fn-1" ? elsewhere : null),
    };
    const reply = {
      parentElement: transcript,
      querySelector: (selector: string) => (selector === "#user-content-fn-1" ? inReply : null),
    };
    const paragraph = { parentElement: reply, querySelector: () => null };
    const behavior = replyLinkBehavior("#user-content-fn-1", { workspace: WS, openFile });
    expect(behavior.target).toBeUndefined();
    const event = click({ parentElement: paragraph });
    behavior.onClick!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(inReply.scrollIntoView).toHaveBeenCalledOnce();
    expect(elsewhere.scrollIntoView).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });
});
