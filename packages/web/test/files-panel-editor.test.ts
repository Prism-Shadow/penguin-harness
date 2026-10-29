// @vitest-environment jsdom
/**
 * The Files panel's editor header (features/chat/workspace-browser.tsx): ✓ and ✗, against a
 * Session's Workspace behind the package's fetch fake that keeps one text file.
 *
 * - Given typed changes, ✓ asks to overwrite, writes the text against the version it opened,
 *   and goes back to the preview, which shows what was written.
 * - Given no changes, ✓ goes back to the preview without writing or asking.
 * - Given typed changes, ✗ drops them without asking: nothing is written, the preview shows the
 *   file as it was, and Edit opens on the file again rather than on the dropped text.
 * - Given a file rewritten since it was opened, ✓ meets the conflict question and the editor
 *   stays open on the typed text.
 * - Given text typed while ✓'s write is on its way, the editor stays open with that text unsaved.
 * - The save shortcut writes and keeps the editor open.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { AuthProvider } from "../src/state/auth";
import { WorkspaceBrowser } from "../src/features/chat/workspace-browser";
import { S } from "../src/lib/strings";
import { ADMIN_ME } from "./helpers/admin-settings";
import { button, click, dialogs, mount, run, type, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FetchRequest } from "./helpers/fetch";
import { SignedIn } from "./helpers/signed-in";

/**
 * The panel keeps a closed editor's unsaved text per Workspace for the life of the page, so each
 * test opens a Session of its own.
 */
let session = "";
let opened = 0;
const FILE = "notes.txt";
const ORIGINAL = "first line\nsecond line\n";

interface Disk {
  /** The file's text now. */
  text(): string;
  /** Writes sent so far, as the text they carried and the version they were made against. */
  writes(): { text: string; ifVersion: string | undefined }[];
  /** The next write is refused as made against a file that changed. */
  refuseNextWrite(): void;
  /** The next write waits until the returned function is called. */
  holdNextWrite(): () => void;
}

function disk(): Disk {
  opened += 1;
  session = `session-${opened}`;
  let text = ORIGINAL;
  let version = 1;
  let refuse = false;
  let hold: Promise<void> | null = null;
  const fetch = stubFetch(async (request) => {
    const { method, path, query } = request;
    if (path === "/api/me") return json(ADMIN_ME);
    if (path === "/api/me/prefs") return json({ prefs: {} });
    const base = `/api/sessions/${session}/files`;
    if (path === base && method === "GET") {
      return json({
        path: query.get("path") ?? "",
        entries: [
          { name: FILE, kind: "file", sizeBytes: text.length, mtime: "2026-10-29T00:00:00Z" },
        ],
      });
    }
    if (path === `${base}/content` && method === "GET") {
      return new Response(text, {
        headers: { "content-type": "text/plain", etag: `W/"${version}"` },
      });
    }
    if (path === `${base}/content` && method === "PUT") {
      const waiting = hold;
      hold = null;
      if (waiting !== null) await waiting;
      if (refuse) {
        refuse = false;
        return apiError(409, "file_changed");
      }
      text = Buffer.from((request.body as { dataBase64: string }).dataBase64, "base64").toString();
      version += 1;
      return new Response(null, { status: 204, headers: { etag: `W/"${version}"` } });
    }
    return apiError(404, "not_found");
  });
  const puts = (): FetchRequest[] =>
    fetch.requests.filter((r) => r.method === "PUT" && r.path.endsWith("/files/content"));
  return {
    text: () => text,
    writes: () =>
      puts().map((r) => {
        const body = r.body as { dataBase64: string; ifVersion?: string };
        return {
          text: Buffer.from(body.dataBase64, "base64").toString(),
          ifVersion: body.ifVersion,
        };
      }),
    refuseNextWrite: () => {
      refuse = true;
    },
    holdNextWrite: () => {
      let release = () => {};
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

/** Mounts the panel, opens the file and presses Edit; resolves once the editor holds the text. */
async function openEditor(): Promise<void> {
  await mount(
    h(
      AuthProvider,
      null,
      h(
        SignedIn,
        null,
        h(WorkspaceBrowser, { scope: { kind: "session", sessionId: session }, active: true }),
      ),
    ),
  );
  await waitFor(() => document.querySelector(`[data-tree-path="${FILE}"]`) !== null);
  await click(document.querySelector(`[data-tree-path="${FILE}"]`)!);
  await waitFor(() => preview().includes("first line"));
  await click(button(S.common.edit));
  await waitFor(() => editor() !== null);
}

const editor = (): HTMLTextAreaElement | null =>
  document.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${S.files.editorLabel(FILE)}"]`,
  );

/** The text the source view (or the editor's code layer) shows. */
const preview = (): string =>
  [...document.querySelectorAll(".code-surface .line")].map((l) => l.textContent).join("\n");

/** Whether `dialog` offers a button named `name`. */
const hasButton = (dialog: HTMLElement, name: string): boolean =>
  [...dialog.querySelectorAll("button")].some((b) => b.textContent?.trim() === name);

/** The open dialog's button named `name`. */
const inDialog = (name: string): HTMLButtonElement => {
  const found = [...(dialogs().at(-1)?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === name,
  );
  if (found === undefined) throw new Error(`no dialog button named ${JSON.stringify(name)}`);
  return found;
};

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
});

describe("the Files panel editor's ✓ and ✗", () => {
  it("✓ writes the typed text against the opened version and goes back to the preview", async () => {
    const files = disk();
    await openEditor();
    await type(editor()!, "first line edited\nsecond line\n");

    await click(button(S.common.save));
    await click(inDialog(S.common.save));
    await waitFor(() => editor() === null);

    expect(files.writes()).toEqual([
      { text: "first line edited\nsecond line\n", ifVersion: 'W/"1"' },
    ]);
    expect(preview()).toContain("first line edited");
  });

  it("✓ with nothing changed goes back to the preview without writing or asking", async () => {
    const files = disk();
    await openEditor();

    await click(button(S.common.save));

    expect(editor()).toBeNull();
    expect(dialogs()).toEqual([]);
    expect(files.writes()).toEqual([]);
  });

  it("✗ drops the typed text without asking, and Edit opens on the file again", async () => {
    const files = disk();
    await openEditor();
    await type(editor()!, "scratch\n");

    await click(button(S.files.discardChanges));

    expect(dialogs()).toEqual([]);
    expect(editor()).toBeNull();
    expect(files.writes()).toEqual([]);
    expect(preview()).toContain("first line");

    await click(button(S.common.edit));
    await waitFor(() => editor() !== null);
    expect(editor()!.value).toBe(ORIGINAL);
  });

  it("✓ on a file rewritten since it was opened meets the conflict question, and the editor stays", async () => {
    const files = disk();
    await openEditor();
    files.refuseNextWrite();
    await type(editor()!, "mine\n");

    await click(button(S.common.save));
    await click(inDialog(S.common.save));
    await waitFor(() => dialogs().some((d) => hasButton(d, S.files.overwriteAnyway)));

    expect(editor()?.value).toBe("mine\n");
    expect(files.text()).toBe(ORIGINAL);
  });

  it("text typed while ✓'s write is on its way stays in the editor, unsaved", async () => {
    const files = disk();
    await openEditor();
    const release = files.holdNextWrite();
    await type(editor()!, "one\n");

    await click(button(S.common.save));
    await click(inDialog(S.common.save));
    await type(editor()!, "one\ntwo\n");
    await run(release);
    await waitFor(() => files.text() === "one\n");

    expect(editor()?.value).toBe("one\ntwo\n");
    expect(document.body.textContent).toContain(S.files.unsaved);
  });

  it("the save shortcut writes and keeps the editor open", async () => {
    const files = disk();
    await openEditor();
    await type(editor()!, "kept open\n");

    await act(async () => {
      editor()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    await click(inDialog(S.common.save));
    await waitFor(() => files.text() === "kept open\n");

    expect(editor()?.value).toBe("kept open\n");
  });
});
