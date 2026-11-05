// @vitest-environment jsdom
/**
 * The archive page as it reads (features/settings/archived-sessions-section.tsx), against the
 * fetch fake answering the archive routes.
 *
 * - Given a person's archived conversation and a program's, every row names its source in a pill
 *   — the person's included.
 * - Given a machine's group, its heading names the machine after the Workspace, and its rows name
 *   their source the same way (a conversation the machine held before it was adopted reads CLI).
 * - Given a machine the server could not read, one line above the list names it.
 * - Given a group of more than ten, it shows ten rows and a pager; while the next page loads the
 *   rows on screen stay as they are and both steps are off, then the next page's rows replace
 *   them, and stepping back shows the first page again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { SessionInfo, SessionSource } from "@prismshadow/penguin-server/api";
import { ArchivedSessionsSection } from "../src/features/settings/archived-sessions-section";
import { AuthProvider } from "../src/state/auth";
import { LocaleProvider } from "../src/state/locale";
import { ProjectProvider } from "../src/state/project";
import { S } from "../src/lib/strings";
import { ADMIN_ME } from "./helpers/admin-settings";
import { button, click, mount, settle, unmountAll, waitFor, watchText } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";

const PROJECT = "proj";
const MACHINE = "QS7J4YVgSovi-Z2c";

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

function row(
  sessionId: string,
  title: string,
  source: SessionSource,
  lastActiveAt = "2026-10-14T09:00:00.000Z",
): SessionInfo {
  return {
    sessionId,
    projectId: PROJECT,
    agentId: "a1",
    provider: "custom",
    modelId: "m",
    workspace: "/srv/app",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    title,
    source,
    createdAt: lastActiveAt,
    lastActiveAt,
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: true,
  } as SessionInfo;
}

/**
 * This server's archive as one group of `local`, newest first, paged as the route pages it
 * (`limit`, and `before` as `<lastActiveAt>,<sessionId>`), with no machine; a page asked below
 * a row waits for `hold` when one is given.
 */
function serveOneGroup(local: SessionInfo[], hold?: Promise<void>) {
  return stubFetch(async (request) => {
    const common = commonRoute(request.path);
    if (common !== null) return common;
    if (request.path === "/api/me/archived-sessions/groups") {
      const asOf = "2026-10-15T10:00:00.000Z";
      if (request.query.get("servers") === "machines") return json({ groups: [], total: 0, asOf });
      const group = { projectId: PROJECT, projectName: "Project", workspace: "/srv/app" };
      const latest = local[0]!.lastActiveAt;
      return json({
        groups: [{ ...group, count: local.length, latest }],
        total: local.length,
        asOf,
      });
    }
    if (request.path === "/api/me/archived-sessions") {
      const before = request.query.get("before");
      const below = before?.slice(before.indexOf(",") + 1);
      const from = below === undefined ? 0 : local.findIndex((s) => s.sessionId === below) + 1;
      if (below !== undefined && hold !== undefined) await hold;
      const limit = Number(request.query.get("limit"));
      const sessions = local.slice(from, from + limit);
      return json({ sessions, hasMore: from + limit < local.length });
    }
    return apiError(404, "not_found");
  });
}

/** The routes every page of the app asks for: who is signed in, their Project, its Agents. */
function commonRoute(path: string): Response | null {
  if (path === "/api/me") return json(ADMIN_ME);
  if (path === "/api/projects") {
    return json({
      projects: [
        {
          projectId: PROJECT,
          name: "Project",
          role: "owner",
          ownerUserId: "admin",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
  }
  if (path === `/api/projects/${PROJECT}/agents`) return json({ agents: [] });
  return null;
}

function serve() {
  return stubFetch((request) => {
    const common = commonRoute(request.path);
    if (common !== null) return common;
    if (request.path === "/api/me/archived-sessions/groups") {
      const group = { projectId: PROJECT, projectName: "Project", workspace: "/srv/app" };
      // The page asks this server's groups and the machines' apart.
      if (request.query.get("servers") === "machines") {
        return json({
          groups: [
            {
              ...group,
              count: 1,
              latest: "2026-10-14T08:00:00.000Z",
              machineId: MACHINE,
              machineAlias: "box",
              asOf: "2026-10-15T10:00:00.000Z",
            },
          ],
          total: 1,
          asOf: "2026-10-15T10:00:00.000Z",
          unreachable: [{ machineId: "x", alias: "nas" }],
        });
      }
      return json({
        groups: [{ ...group, count: 2, latest: "2026-10-14T09:00:00.000Z" }],
        total: 2,
        asOf: "2026-10-15T10:00:00.000Z",
      });
    }
    if (request.path === "/api/me/archived-sessions") {
      const sessions =
        request.query.get("machineId") === MACHINE
          ? [row("m-1", "Earlier on the box", "cli")]
          : [row("l-1", "Quarterly report", "user"), row("l-2", "Nightly build", "schedule")];
      return json({ sessions, hasMore: false });
    }
    return apiError(404, "not_found");
  });
}

/** jsdom has no `matchMedia`; the page asks whether a fine pointer is the way in. */
const unmatchedQuery = (media: string) => ({
  matches: false,
  media,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

/**
 * The page as the app mounts it, its fetch answered by `stub`. Under the app's `LocaleProvider`,
 * the shared package's controls (the pager) speak the same dictionary `S` reads.
 */
async function open(stub: () => unknown = serve) {
  stub();
  vi.stubGlobal("matchMedia", unmatchedQuery);
  const mounted = await mount(
    h(
      LocaleProvider,
      null,
      h(AuthProvider, null, h(ProjectProvider, null, h(ArchivedSessionsSection))),
    ),
  );
  await settle();
  return mounted.container;
}

/** Each listed row: its title and the source its pill names. */
const listed = (container: HTMLElement) =>
  [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");

describe("the archive page's rows", () => {
  it("names every row's source in a pill, a person's conversation included", async () => {
    const page = await open();
    const rows = listed(page);
    expect(rows.find((r) => r.includes("Quarterly report"))).toContain(S.chat.sessionSource.user);
    expect(rows.find((r) => r.includes("Nightly build"))).toContain(S.chat.sessionSource.schedule);
  });

  it("names the machine after a machine group's Workspace, and its rows' source the same way", async () => {
    const page = await open();
    const headings = [...page.querySelectorAll("h3")].map((h3) => h3.textContent ?? "");
    expect(headings.filter((text) => text.includes(S.chat.machineTag("box")))).toHaveLength(1);
    expect(listed(page).find((r) => r.includes("Earlier on the box"))).toContain(
      S.chat.sessionSource.cli,
    );
  });

  it("names a machine it could not read above the list", async () => {
    const page = await open();
    expect(page.textContent).toContain(S.archivedSessions.unreachable(["nas"]));
  });
});

describe("the archive page's pages", () => {
  it("keeps a group's rows on screen with the steps off while the next page loads, then shows it", async () => {
    // Twelve conversations, newest first: "Chat 12" down to "Chat 01".
    const local = Array.from({ length: 12 }, (_, i) => {
      const n = String(12 - i).padStart(2, "0");
      return row(`s-${n}`, `Chat ${n}`, "cli", `2026-10-14T09:${n}:00.000Z`);
    });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const page = await open(() => serveOneGroup(local, hold));
    const titles = () => listed(page).map((text) => /Chat \d+/.exec(text)?.[0]);
    await waitFor(() => titles().length > 0);
    expect(titles()).toEqual(local.slice(0, 10).map((s) => s.title));
    const next = button(S.common.nextPage);
    const back = button(S.common.previousPage);
    expect(back.disabled).toBe(true);

    const list = watchText("ul");
    await click(next);
    // The second page is on its way: the first stays, and neither step can be pressed.
    expect(titles()).toEqual(local.slice(0, 10).map((s) => s.title));
    expect(next.disabled).toBe(true);
    expect(back.disabled).toBe(true);

    release();
    await waitFor(() => titles()[0] === "Chat 02");
    expect(titles()).toEqual(["Chat 02", "Chat 01"]);
    // The list went from the first page straight to the second: nothing in between.
    list.stop();
    expect(list.texts()).toHaveLength(2);
    expect(next.disabled).toBe(true);
    expect(back.disabled).toBe(false);

    await click(back);
    expect(titles()).toEqual(local.slice(0, 10).map((s) => s.title));
  });
});
