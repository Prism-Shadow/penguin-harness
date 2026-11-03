// @vitest-environment jsdom
/**
 * The details a failed model request opens from 「[详情]」 (features/chat/request-failure-dialog.tsx),
 * on a page signed in to the desktop app's own server.
 *
 * - Given a failure on this server, the dialog shows the report as it would be shared: the
 *   provider's message, the model, the attempts of how many, the version, how it is installed
 *   and this server's OS — and no key-shaped string, though the provider's message held one.
 * - Given Copy, the clipboard gets that same report, and a toast says it was copied.
 * - Given the GitHub link, it opens the project's bug form in a new tab, prefilled.
 * - Given a Session on another machine, the OS is that machine's, asked of that machine.
 * - Given Close, the page is told.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { ClipboardWriterProvider, toastStore } from "@prismshadow/penguin-ui";
import type { VersionResponse } from "@prismshadow/penguin-server/api";
import { ADMIN_ME } from "./helpers/admin-settings";
import { button, click, mount, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { RequestFailureDialog } from "../src/features/chat/request-failure-dialog";
import type { RequestFailure } from "../src/features/chat/request-failure-report";
import { ReportEnvironmentSync } from "../src/lib/report-environment";
import { rememberSessionMachine } from "../src/lib/session-machines";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AuthProvider } from "../src/state/auth";

/** The clipboard entry the app hands the UI package (its own behaviour is clipboard.test.ts's). */
const writeClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());

/** The toasts on screen, by their words. */
const toasts = () => toastStore.getState().items.map((item) => item.text);

const SESSION = "session-2026-11-02-08-40-00-a1b2c3d4";
const MACHINE = "QS7J4YVgSovi-Z2c";
const KEY = "sk-proj-Ab3dEf6hIj9kLm2nOp5q";

const version = (over: Partial<VersionResponse>): VersionResponse =>
  ({
    version: "0.2.18",
    describe: "v0.2.18",
    channel: "release",
    buildDate: "2026-10-30",
    commit: null,
    branch: null,
    dirty: null,
    runtime: { node: "24.20.0", platform: "darwin", arch: "arm64" },
    harness: null,
    ...over,
  }) as VersionResponse;

const FAILURE: RequestFailure = {
  phase: "gaveUp",
  attempt: 6,
  maxAttempts: 10,
  status: "retryable",
  errorCode: "network",
  message: `503 overloaded; echoed key ${KEY}`,
  model: { provider: "custom", modelId: "claude-4-8" },
  atMs: Date.parse("2026-11-02T08:41:13Z"),
};

function server() {
  return stubFetch((request) => {
    if (request.path === "/api/me") {
      return json({ ...ADMIN_ME, desktopMode: true, sessionVia: "desktop" });
    }
    if (request.path === "/api/me/prefs") return json({ prefs: {} });
    if (request.path === "/api/version") {
      return json(
        request.machine === null
          ? version({})
          : version({
              describe: "v0.2.16",
              runtime: { node: "24.20.0", platform: "linux", arch: "x64" },
            }),
      );
    }
    return apiError(404, "not_found");
  });
}

/** The dialog over a signed-in page, for the Session on `machine` (null: this server). */
async function open(onClose = vi.fn(), machine: string | null = null) {
  setActiveStrings(en);
  rememberSessionMachine(SESSION, machine);
  await mount(
    h(
      ClipboardWriterProvider,
      { write: writeClipboard },
      h(
        AuthProvider,
        null,
        // The app's root hands every report its environment; the dialog reads it from there.
        h(ReportEnvironmentSync),
        h(RequestFailureDialog, {
          failure: FAILURE,
          sessionId: SESSION,
          sessionModel: null,
          workspace: "/home/alice/acme",
          onClose,
        }),
      ),
    ),
  );
  return { words: en.report, onClose };
}

const report = () => document.querySelector("[data-report]")?.textContent ?? "";

afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
  toastStore.setState({ items: [] });
  writeClipboard.mockReset();
  vi.unstubAllGlobals();
});

describe("a failed request's details", () => {
  it("shows the report as it would be shared, with no key from the provider's message", async () => {
    server();
    await open();
    await waitFor(() => report().includes("Installed as: Desktop app"));
    const shown = report();
    expect(shown).toContain("503 overloaded; echoed key");
    expect(shown).toContain("- Model: claude-4-8");
    expect(shown).toContain("6 attempts failed (at most 10)");
    expect(shown).toContain("- PenguinHarness: v0.2.18");
    expect(shown).toContain("- OS: macOS (arm64)");
    expect(shown).not.toContain(KEY);
    expect(document.body.textContent).not.toContain(KEY);
  });

  it("copies that same report, and says so", async () => {
    server();
    writeClipboard.mockResolvedValue(true);
    const { words } = await open();
    await waitFor(() => report().includes("Installed as"));
    await click(button(words.copy));
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(report());
    expect(toasts()).toEqual([words.copied]);
  });

  it("links to the project's bug form in a new tab, prefilled", async () => {
    server();
    await open();
    await waitFor(() => report().includes("Installed as"));
    const link = document.querySelector<HTMLAnchorElement>("a[data-file-issue]")!;
    expect(link.target).toBe("_blank");
    const url = new URL(link.href);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://github.com/Prism-Shadow/penguin-harness/issues/new",
    );
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("system-info")).toBe(
      "Version: v0.2.18\nInstalled as: Desktop app\nOS: macOS (arm64)",
    );
    expect(url.searchParams.get("output")).not.toContain(KEY);
  });

  it("names the OS of the machine a Session runs on, asked of that machine", async () => {
    const fetch = server();
    await open(vi.fn(), MACHINE);
    await waitFor(() => report().includes("Linux (x64)"));
    expect(report()).toContain(
      "- OS: Linux (x64), the remote machine the Session runs on (PenguinHarness v0.2.16)",
    );
    expect(fetch.requests.some((r) => r.machine === MACHINE && r.path === "/api/version")).toBe(
      true,
    );
  });

  it("tells the page when it is closed", async () => {
    server();
    const { onClose } = await open();
    await click(button("Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
