// @vitest-environment jsdom
/**
 * The Files panel's editor header (features/chat/workspace-browser.tsx): ✓ and ✗, against a
 * Session's Workspace behind the package's fetch fake that keeps one text file.
 *
 * - Given typed changes, ✓ writes the text at once against the version it opened — no dialog —
 *   and goes back to the preview, which shows what was written, with the focus on Edit.
 * - Given no changes, ✓ goes back to the preview without writing or asking.
 * - Given typed changes, ✗ drops them without asking: nothing is written, the preview shows the
 *   file as it was, and Edit opens on the file again rather than on the dropped text.
 * - Given a file rewritten since it was opened, ✓ meets the conflict question with the editor
 *   still open on the typed text; overwriting from there writes without the version and goes
 *   back to the preview.
 * - Given a write that fails for another reason, ✓ leaves the editor open on the typed text.
 * - Given a server that answers a write with no version, ✓ goes back to the preview, and the
 *   next Edit reads the file again.
 * - Given text typed while ✓'s write is on its way, the editor stays open with that text unsaved.
 * - The save shortcut writes at once and keeps the editor open.
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
  /** The next write is refused with this error, nothing written. */
  refuseNextWrite(status: number, code: string): void;
  /** The next write lands but answers with no version. */
  answerNextWithoutVersion(): void;
  /** Reads of the file's content so far. */
  reads(): number;
  /** The next write waits until the returned function is called. */
  holdNextWrite(): () => void;
}

function disk(): Disk {
  opened += 1;
  session = `session-${opened}`;
  let text = ORIGINAL;
  let version = 1;
  let refuse: { status: number; code: string } | null = null;
  let withoutVersion = false;
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
      if (refuse !== null) {
        const { status, code } = refuse;
        refuse = null;
        return apiError(status, code);
      }
      text = Buffer.from((request.body as { dataBase64: string }).dataBase64, "base64").toString();
      version += 1;
      if (withoutVersion) {
        withoutVersion = false;
        return new Response(null, { status: 204 });
      }
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
    refuseNextWrite: (status, code) => {
      refuse = { status, code };
    },
    answerNextWithoutVersion: () => {
      withoutVersion = true;
    },
    reads: () =>
      fetch.requests.filter((r) => r.method === "GET" && r.path.endsWith("/files/content")).length,
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
  it("✓ writes the typed text at once against the opened version and goes back to the preview", async () => {
    const files = disk();
    await openEditor();
    await type(editor()!, "first line edited\nsecond line\n");

    await click(button(S.files.saveAndClose));
    await waitFor(() => editor() === null);

    expect(dialogs()).toEqual([]);
    expect(files.writes()).toEqual([
      { text: "first line edited\nsecond line\n", ifVersion: 'W/"1"' },
    ]);
    expect(preview()).toContain("first line edited");
    expect(document.activeElement).toBe(button(S.common.edit));
  });

  it("✓ with nothing changed goes back to the preview without writing or asking", async () => {
    const files = disk();
    await openEditor();

    await click(button(S.files.saveAndClose));

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

  it("✓ on a file rewritten since it was opened asks first, and overwriting from there leaves", async () => {
    const files = disk();
    await openEditor();
    files.refuseNextWrite(409, "file_changed");
    await type(editor()!, "mine\n");

    await click(button(S.files.saveAndClose));
    await waitFor(() => dialogs().some((d) => hasButton(d, S.files.overwriteAnyway)));
    expect(editor()?.value).toBe("mine\n");
    expect(files.text()).toBe(ORIGINAL);

    await click(inDialog(S.files.overwriteAnyway));
    await waitFor(() => editor() === null);

    expect(files.writes().at(-1)).toEqual({ text: "mine\n", ifVersion: undefined });
    expect(files.text()).toBe("mine\n");
  });

  it("✓ whose write fails for another reason leaves the editor open on the typed text", async () => {
    const files = disk();
    await openEditor();
    files.refuseNextWrite(500, "internal");
    await type(editor()!, "mine\n");

    await click(button(S.files.saveAndClose));
    await waitFor(() => files.writes().length === 1);

    expect(editor()?.value).toBe("mine\n");
    expect(files.text()).toBe(ORIGINAL);
    expect(dialogs()).toEqual([]);
  });

  it("✓ answered with no version goes back to the preview, and the next Edit reads the file again", async () => {
    const files = disk();
    await openEditor();
    files.answerNextWithoutVersion();
    await type(editor()!, "saved\n");

    await click(button(S.files.saveAndClose));
    await waitFor(() => editor() === null);
    const before = files.reads();

    await click(button(S.common.edit));
    await waitFor(() => editor() !== null);

    expect(files.reads()).toBe(before + 1);
    expect(editor()!.value).toBe("saved\n");
  });

  it("text typed while ✓'s write is on its way stays in the editor, unsaved", async () => {
    const files = disk();
    await openEditor();
    const release = files.holdNextWrite();
    await type(editor()!, "one\n");

    await click(button(S.files.saveAndClose));
    await type(editor()!, "one\ntwo\n");
    await run(release);
    await waitFor(() => files.text() === "one\n");

    expect(editor()?.value).toBe("one\ntwo\n");
    expect(document.body.textContent).toContain(S.files.unsaved);
  });

  it("the save shortcut writes at once and keeps the editor open", async () => {
    const files = disk();
    await openEditor();
    await type(editor()!, "kept open\n");

    await act(async () => {
      editor()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => files.text() === "kept open\n");

    expect(dialogs()).toEqual([]);
    expect(editor()?.value).toBe("kept open\n");
  });
});
