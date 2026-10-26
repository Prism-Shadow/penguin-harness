/** @vitest-environment jsdom */
/**
 * The status bar's click through the real container (components/layout/status-bar.tsx), in the
 * shell its reach moves. The presentational suites (status-bar.test.ts) hold the bar's strip to
 * its side of the model seam, and the reach's RULES are driven directly in
 * status-bar-model.test.ts; these cases are the wiring no model can show — one click each, with
 * a probe inside the same providers recording where the shell stands after it:
 *
 * - The reach this round adds: the shell stands in company mode (an organization open, the way
 *   an `/org` route leaves it), the clicked row is a normal Session's (no organization holds
 *   it), and the click takes the shell back to development — the mode settles dev, the open
 *   organization is dropped, the route moves onto the Session and the locate ask is published
 *   for the development list to answer.
 * - The company row of the round before, held to its behaviour: clicked in company mode it
 *   keeps the mode and takes the organization the row names.
 * - A normal row clicked while the shell already stands in development reaches nothing: not
 *   even a mode preference write leaves the browser.
 *
 * Company mode is entered here by the same store call the shell's own entry points make (the
 * mode switch, an `/org` route) once /api/me has turned the server's switch on: a mirror choice
 * alone does not survive a load — the store settles it back to development while the switch is
 * off at load, by its own design, so that is not a way in.
 */
import { createElement as h, useEffect, useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import type { HarnessStatusResponse, HarnessStatusSession } from "@prismshadow/penguin-server/api";
import { StatusBar } from "../src/components/layout/status-bar";
import { useSidebarLocate } from "../src/lib/sidebar-locate";
import { S } from "../src/lib/strings";
import { AuthProvider } from "../src/state/auth";
import { CompanyProvider, useCompany } from "../src/state/company";
import { LocaleProvider } from "../src/state/locale";
import { ProjectProvider } from "../src/state/project";
import { ThemeProvider } from "../src/state/theme";
import { ADMIN_ME } from "./helpers/admin-settings";
import { button, click, hasButton, mount, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";
import { memoryStorage, stubLocalStorage } from "./helpers/storage";
import { PROJECT } from "./helpers/project-settings";

const GB = 1024 ** 3;

/** A row of a Session no organization holds — the development list's own. */
const normalRow: HarnessStatusSession = {
  sessionId: "s-normal",
  projectId: "p1",
  agentId: "helper",
  title: "Plain work",
  workspace: "/srv/app",
  client: "web",
  status: "running",
  lastActiveAt: "2026-10-26T01:00:00Z",
  machineId: null,
  orgId: null,
};

/** A row of the one organization this shell's own list holds. */
const companyRow: HarnessStatusSession = {
  ...normalRow,
  sessionId: "s-org",
  title: "Desk work",
  client: "org",
  orgId: "acme",
};

/** The poll's answer: the rows the case clicks, one machine-less world, this server's load. */
const poll = (rows: HarnessStatusSession[]): HarnessStatusResponse => ({
  running: rows.length,
  sessions: rows,
  system: { cpuPercent: 11, memoryUsedBytes: 2 * GB, memoryTotalBytes: 8 * GB },
  machines: [],
});

/** Where the shell stood when it last committed: the mode, the organization, the route, the ask. */
interface ShellSeen {
  workMode: "dev" | "company";
  orgKey: string | null;
  path: string;
  locate: { sessionId: string; agentId: string; title: string } | null;
}

/** A fly on the shell's wall: records where it stands on every commit, the mount one included. */
function Probe({ record }: { record: (seen: ShellSeen) => void }) {
  const company = useCompany();
  const locate = useSidebarLocate();
  const { pathname } = useLocation();
  useEffect(() => {
    record({
      workMode: company.workMode,
      orgKey: company.currentOrgKey,
      path: pathname,
      locate:
        locate === null
          ? null
          : { sessionId: locate.sessionId, agentId: locate.agentId, title: locate.title },
    });
  });
  return null;
}

/**
 * Enters company mode the way the shell's own entry points do — the mode switch's store call,
 * and the organization an `/org` landing opens — once /api/me has made the mode available. This
 * world mounts no routes, so the store calls stand in for the route that would have made them.
 */
function EnterCompanyMode({ withOrg = null }: { withOrg?: string | null }) {
  const company = useCompany();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !company.available) return;
    done.current = true;
    company.setWorkMode("company");
    if (withOrg !== null) company.setCurrentOrg(withOrg);
  });
  return null;
}

/**
 * The shell's server: the admin (company mode on), the one Project with its one organization,
 * and the poll's rows. Everything else answers 404 the way a tolerant shell shrugs it off —
 * the org-sessions, channels and chart the company surfaces would read are not what these
 * cases are about.
 */
function shellServer(rows: HarnessStatusSession[]): FakeFetch {
  return stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/organizations") {
      return json({ organizations: [{ projectId: "p1", orgId: "acme" }] });
    }
    if (req.path === "/api/harness-status") return json(poll(rows));
    return apiError(404, "not_found");
  });
}

/** Mounts the real bar inside the shell it runs in, with `enter` standing in for the user's move. */
async function barInShell(rows: HarnessStatusSession[], enter: ReturnType<typeof h> | null) {
  stubLocalStorage(memoryStorage()); // a browser of this test alone: the bar's kept sets start empty
  const network = shellServer(rows);
  const seen: ShellSeen[] = [];
  await mount(
    h(
      MemoryRouter,
      { initialEntries: ["/chat"] },
      h(
        LocaleProvider,
        null,
        h(
          ThemeProvider,
          null,
          h(
            AuthProvider,
            null,
            h(
              ProjectProvider,
              null,
              h(
                CompanyProvider,
                null,
                h(Probe, { record: (entry) => seen.push(entry) }),
                enter,
                h(StatusBar),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  // The bar renders only once the first poll has landed; the list opens from its counts.
  const counts = S.statusBar.sessions(poll(rows).running, 0);
  await waitFor(() => hasButton(counts));
  await click(button(counts));
  return { network, seen };
}

/** Every work-mode preference the browser sent, in order — the reach's own paper trail. */
const modeWrites = (network: FakeFetch) =>
  network.requests
    .filter((r) => r.method === "PUT" && r.path === "/api/me/prefs")
    .map((r) => (r.body as { workMode?: string }).workMode)
    .filter((mode) => mode !== undefined);

beforeEach(() => {
  // The conversations' live stream, which jsdom does not have; nothing here listens to it.
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => unmountAll());

it("takes the shell back to development for a normal row clicked in company mode", async () => {
  const { network, seen } = await barInShell(
    [normalRow],
    h(EnterCompanyMode, { withOrg: "p1/acme" }),
  );
  // The shell the click must find: company mode, an organization open, the way /org leaves it.
  await waitFor(() => seen.at(-1)!.workMode === "company" && seen.at(-1)!.orgKey === "p1/acme");
  await click(button(`Plain work · ${S.statusBar.runningLabel}`));
  await waitFor(() => seen.at(-1)!.workMode === "dev" && seen.at(-1)!.path === "/chat/s-normal");
  // Mode, organization, route and ask, all where the development sidebar can answer.
  expect(seen.at(-1)).toEqual({
    workMode: "dev",
    orgKey: null,
    path: "/chat/s-normal",
    locate: { sessionId: "s-normal", agentId: "helper", title: "Plain work" },
  });
  // The mode left the browser too, the entry's write undone by the click's: dev, as stands.
  expect(modeWrites(network)).toEqual(["company", "dev"]);
});

it("keeps a listed company row's reach: company mode stays, the organization is taken", async () => {
  const { network, seen } = await barInShell([companyRow], h(EnterCompanyMode));
  await waitFor(() => seen.at(-1)!.workMode === "company" && seen.at(-1)!.orgKey === null);
  await click(button(`Desk work · ${S.statusBar.runningLabel}`));
  await waitFor(() => seen.at(-1)!.orgKey === "p1/acme" && seen.at(-1)!.path === "/chat/s-org");
  expect(seen.at(-1)).toEqual({
    workMode: "company",
    orgKey: "p1/acme",
    path: "/chat/s-org",
    locate: { sessionId: "s-org", agentId: "helper", title: "Desk work" },
  });
  // The click did not rewrite the mode it already stood in; the organization is what moved.
  expect(modeWrites(network)).toEqual(["company"]);
});

it("reaches nothing for a normal row clicked while already in development — not even a write", async () => {
  const { network, seen } = await barInShell([normalRow], null);
  await click(button(`Plain work · ${S.statusBar.runningLabel}`));
  await waitFor(() => seen.at(-1)!.path === "/chat/s-normal");
  expect(seen.at(-1)).toEqual({
    workMode: "dev",
    orgKey: null,
    path: "/chat/s-normal",
    locate: { sessionId: "s-normal", agentId: "helper", title: "Plain work" },
  });
  expect(seen.every((entry) => entry.workMode === "dev")).toBe(true);
  // The jump and the ask happened without the mode's help: no mode write left the browser.
  expect(modeWrites(network)).toEqual([]);
});
