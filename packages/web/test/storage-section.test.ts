// @vitest-environment jsdom
/**
 * The Storage page as it reads (features/settings/storage-section.tsx), against the fetch fake
 * answering who is signed in and the usage.
 *
 * - Given an admin's usage (it carries the whole data root), the page heads with This server,
 *   its folder is the data root, and the Projects of other users are one row with their count.
 * - Given a member's usage, the page heads with My Projects and lists each Project's folder; in a
 *   browser there is no button to show a folder, while the desktop shell's own window has one per
 *   folder, which asks the server to show that Project's folder.
 * - Given Archived chats' Open, the page hands over to the dialog's switch.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { MeResponse, StorageUsage } from "@prismshadow/penguin-server/api";
import { StorageSection } from "../src/features/settings/storage-section";
import { AuthProvider } from "../src/state/auth";
import { LocaleProvider } from "../src/state/locale";
import { S } from "../src/lib/strings";
import { ADMIN_ME } from "./helpers/admin-settings";
import { button, click, hasButton, mount, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch, type FakeFetch } from "./helpers/fetch";

const GB = 1024 ** 3;
const ZERO = {
  traces: 0,
  agentState: 0,
  workspaces: 0,
  scratchpads: 0,
  caches: 0,
  logs: 0,
  plugins: 0,
  other: 0,
};

function project(projectId: string, bytes: number) {
  return {
    projectId,
    name: projectId,
    path: `/srv/penguin/${projectId}`,
    bytes,
    categories: { ...ZERO, traces: bytes },
    agents: [],
  };
}

const MEMBER: StorageUsage = {
  measuredAt: "2026-11-19T08:00:00.000Z",
  measuring: false,
  bytes: 3 * GB,
  categories: { ...ZERO, traces: 3 * GB },
  projects: [project("docs", 2 * GB), project("notes", 1 * GB)],
};

const ADMIN: StorageUsage = {
  ...MEMBER,
  server: {
    root: "/srv/penguin",
    bytes: 5 * GB,
    categories: { ...ZERO, traces: 4 * GB, logs: 1 * GB },
    otherProjects: { count: 2, bytes: 1 * GB },
    entries: [{ name: "logs", category: "logs", bytes: 1 * GB }],
  },
};

let fetch: FakeFetch;

async function open(usage: StorageUsage, me: MeResponse = ADMIN_ME) {
  fetch = stubFetch((request) => {
    if (request.path === "/api/me") return json(me);
    if (request.path === "/api/me/storage") return json(usage);
    if (request.path === "/api/me/storage/reveal") return new Response(null, { status: 204 });
    return apiError(404, "not_found");
  });
  const handed: string[] = [];
  const { container } = await mount(
    h(
      LocaleProvider,
      null,
      h(AuthProvider, null, h(StorageSection, { onOpenArchived: () => handed.push("archived") })),
    ),
  );
  await waitFor(() => container.querySelector("h3") !== null);
  return { container, handed };
}

const headings = (container: HTMLElement) =>
  [...container.querySelectorAll("h3")].map((x) => x.textContent);

const text = (container: HTMLElement) => container.textContent ?? "";

afterEach(unmountAll);

describe("the Storage page", () => {
  it("shows an admin the whole data root, and other users' Projects as one row", async () => {
    const { container } = await open(ADMIN);
    expect(headings(container)[0]).toBe(S.storage.thisServer);
    expect(text(container)).toContain("/srv/penguin");
    expect(text(container)).not.toContain("/srv/penguin/docs");
    expect(text(container)).toContain(S.storage.otherProjects(2));
  });

  it("shows a member their Projects' folders, with Show in folder only in the desktop window", async () => {
    const browser = await open(MEMBER);
    expect(headings(browser.container)[0]).toBe(S.storage.myProjects);
    expect(text(browser.container)).toContain("/srv/penguin/docs");
    expect(text(browser.container)).toContain("/srv/penguin/notes");
    expect(hasButton(S.storage.reveal)).toBe(false);
    await unmountAll();

    await open(MEMBER, { ...ADMIN_ME, desktopMode: true, sessionVia: "desktop" });
    await waitFor(() => hasButton(S.storage.reveal));
    const reveal = [...document.querySelectorAll("button")].filter(
      (b) => b.getAttribute("aria-label") === S.storage.reveal,
    );
    expect(reveal).toHaveLength(2);
    await click(reveal[0]!);
    const asked = fetch.requests.filter((r) => r.path === "/api/me/storage/reveal");
    expect(asked.map((r) => r.body)).toEqual([{ projectId: "docs" }]);
  });

  it("hands over to the dialog's switch from Archived chats' Open", async () => {
    const { handed } = await open(MEMBER);
    await click(button(S.storage.open));
    expect(handed).toEqual(["archived"]);
  });
});
