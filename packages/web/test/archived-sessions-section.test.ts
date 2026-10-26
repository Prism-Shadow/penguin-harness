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
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { SessionInfo, SessionSource } from "@prismshadow/penguin-server/api";
import { ArchivedSessionsSection } from "../src/features/settings/archived-sessions-section";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { S } from "../src/lib/strings";
import { ADMIN_ME } from "./helpers/admin-settings";
import { mount, settle, unmountAll } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";

const PROJECT = "proj";
const MACHINE = "QS7J4YVgSovi-Z2c";

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

function row(sessionId: string, title: string, source: SessionSource): SessionInfo {
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
    createdAt: "2026-10-14T09:00:00.000Z",
    lastActiveAt: "2026-10-14T09:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: true,
  } as SessionInfo;
}

function serve() {
  return stubFetch((request) => {
    if (request.path === "/api/me") return json(ADMIN_ME);
    if (request.path === "/api/projects") {
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
    if (request.path === `/api/projects/${PROJECT}/agents`) return json({ agents: [] });
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

async function open() {
  serve();
  vi.stubGlobal("matchMedia", unmatchedQuery);
  const mounted = await mount(
    h(AuthProvider, null, h(ProjectProvider, null, h(ArchivedSessionsSection))),
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
