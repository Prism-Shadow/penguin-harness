// @vitest-environment jsdom
/**
 * A rendered Markdown file in the Files panel (library/workspace/src/web/workspace-browser.tsx), against
 * a Session's Workspace behind the package's fetch fake that keeps one Markdown file.
 *
 * - Given a rendered Markdown file with an image and a link, when the panel renders again for
 *   something that is not the file, the image and the link on screen are the elements that were
 *   there: the text is not parsed again and nothing in it is rebuilt.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { AuthProvider } from "../src/state/auth";
import { WorkspaceBrowser } from "@prismshadow/penguin-library-workspace/web/workspace-browser";
import { ADMIN_ME } from "./helpers/admin-settings";
import { click, mount, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { SignedIn } from "./helpers/signed-in";

const SESSION = "session-markdown";
const FILE = "notes.md";
const TEXT =
  "# Notes\n\nA picture: ![diagram](img/diagram.png)\n\nSee [the other file](other.md).\n";

function disk(): void {
  stubFetch(async ({ method, path, query }) => {
    if (path === "/api/me") return json(ADMIN_ME);
    if (path === "/api/me/prefs") return json({ prefs: {} });
    const base = `/api/sessions/${SESSION}/files`;
    if (path === base && method === "GET") {
      return json({
        path: query.get("path") ?? "",
        entries: [
          { name: FILE, kind: "file", sizeBytes: TEXT.length, mtime: "2026-11-16T00:00:00Z" },
        ],
      });
    }
    if (path === `${base}/content` && method === "GET") {
      return new Response(TEXT, { headers: { "content-type": "text/plain", etag: 'W/"1"' } });
    }
    return apiError(404, "not_found");
  });
}

const panel = () =>
  h(
    AuthProvider,
    null,
    h(
      SignedIn,
      null,
      h(WorkspaceBrowser, { scope: { kind: "session", sessionId: SESSION }, active: true }),
    ),
  );

const image = () => document.querySelector(".md-body img");
const link = () => document.querySelector(".md-body a");

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
});

describe("a rendered Markdown file in the Files panel", () => {
  it("keeps its image and its link in place when the panel renders again", async () => {
    disk();
    const page = await mount(panel());
    await waitFor(() => document.querySelector(`[data-tree-path="${FILE}"]`) !== null);
    await click(document.querySelector(`[data-tree-path="${FILE}"]`)!);
    await waitFor(() => image() !== null);
    const before = { image: image(), link: link() };

    await page.rerender(panel());

    expect(image()).toBe(before.image);
    expect(link()).toBe(before.link);
  });
});
