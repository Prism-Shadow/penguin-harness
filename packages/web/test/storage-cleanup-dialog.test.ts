// @vitest-environment jsdom
/**
 * Clean up temporary files as the user meets it (plugins/storage/src/web/storage-cleanup-dialog.tsx),
 * against the fetch fake answering the cleanup review and its removal.
 *
 * - Given a review, its groups show in the fixed order with the empty ones left out, what the
 *   server picks is chosen, and the foot reads the count and the size chosen; choosing another
 *   row moves the foot. A scratchpad whose chat is gone reads as a deleted chat, never as its
 *   folder's name (the chat's id).
 * - Given Delete, the confirm asks first and nothing is removed until it is confirmed; then
 *   exactly the chosen items go to the server with the reviewed age, and the dialog hands back to
 *   the page (which measures again) and closes.
 */
// The face's host first: the page calls the app's `apiFetch` and toasts through it.
import "../src/web-app/plugin-host";
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { StorageCleanupItem } from "../../../plugins/storage/src/types";
import { StorageCleanupDialog } from "../../../plugins/storage/src/web/storage-cleanup-dialog";
import { formatSize } from "../../../plugins/storage/src/web/storage-format";
import { LocaleProvider } from "../src/state/locale";
import { S } from "../../../plugins/storage/src/web/strings";
import { button, click, dialogs, mount, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch, type FakeFetch } from "./helpers/fetch";

const MB = 1024 ** 2;

const ITEMS: StorageCleanupItem[] = [
  {
    id: "cache",
    kind: "agentCache",
    reason: "idle",
    projectName: "Docs",
    agentName: "Writer",
    name: "python-3.12",
    bytes: 800 * MB,
    lastModifiedAt: "2026-11-15T00:00:00.000Z",
    selected: false,
  },
  {
    id: "orphan",
    kind: "scratchpad",
    reason: "orphan",
    projectName: "Docs",
    agentName: "Writer",
    name: "s-4e1f9c20",
    bytes: 100 * MB,
    lastModifiedAt: "2026-11-01T00:00:00.000Z",
    selected: true,
  },
  {
    id: "idle",
    kind: "scratchpad",
    reason: "idle",
    projectName: "Docs",
    agentName: "Writer",
    sessionId: "s-1",
    title: "Quarterly report",
    name: "s-1",
    bytes: 40 * MB,
    lastModifiedAt: "2026-10-20T00:00:00.000Z",
    lastActiveAt: "2026-10-20T00:00:00.000Z",
    selected: false,
  },
];

let fetch: FakeFetch;

function serve() {
  fetch = stubFetch((request) => {
    if (request.path !== "/api/me/storage/cleanup") return apiError(404, "not_found");
    if (request.method === "GET") {
      return json({
        measuredAt: "2026-11-19T08:00:00.000Z",
        olderThanDays: Number(request.query.get("olderThanDays")),
        items: ITEMS,
      });
    }
    const ids = (request.body as { items: string[] }).items;
    return json({ removed: ids.length, bytes: 140 * MB, skipped: [] });
  });
}

async function open() {
  serve();
  const calls: string[] = [];
  await mount(
    h(
      LocaleProvider,
      null,
      h(StorageCleanupDialog, {
        onClose: () => calls.push("close"),
        onDone: () => calls.push("done"),
      }),
    ),
  );
  await waitFor(() => document.querySelectorAll("section h3").length > 0);
  return calls;
}

/** The text of the dialog's foot, where the choice is counted. */
const foot = () => dialogs()[0]!.querySelector('[data-slot="foot"]')!.textContent ?? "";

const box = (title: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${S.storage.select(title)}"]`)!;

afterEach(unmountAll);

describe("the cleanup review dialog", () => {
  it("shows the groups in order, chooses the server's picks, and counts the choice in the foot", async () => {
    await open();
    expect([...document.querySelectorAll("section h3")].map((x) => x.textContent)).toEqual([
      S.storage.temp.orphanScratchpads,
      S.storage.temp.idleScratchpads,
      S.storage.temp.agentCaches,
    ]);
    expect(box(S.storage.temp.deletedChat).checked).toBe(true);
    expect(dialogs()[0]!.textContent).not.toContain("s-4e1f9c20");
    expect(box("Quarterly report").checked).toBe(false);
    expect(foot()).toContain(S.storage.selected(1, formatSize(100 * MB)));
    await click(box("Quarterly report"));
    expect(foot()).toContain(S.storage.selected(2, formatSize(140 * MB)));
  });

  it("removes exactly the chosen items once confirmed, then hands back to the page and closes", async () => {
    const calls = await open();
    await click(box("Quarterly report"));
    await click(button(S.storage.delete));
    // The confirm is up; nothing has gone yet.
    expect(fetch.requests.filter((r) => r.method === "POST")).toHaveLength(0);
    const confirm = dialogs().at(-1)!;
    const yes = [...confirm.querySelectorAll("button")].find(
      (b) => b.textContent === S.storage.delete,
    )!;
    await click(yes);
    await waitFor(() => calls.length > 0);
    const posts = fetch.requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.body)).toEqual([{ items: ["orphan", "idle"], olderThanDays: 7 }]);
    expect(calls).toEqual(["done", "close"]);
  });
});
