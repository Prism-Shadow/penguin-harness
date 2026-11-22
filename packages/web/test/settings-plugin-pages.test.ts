// @vitest-environment jsdom
/**
 * The Settings dialog's Plugins group (features/settings/settings-dialog.tsx with
 * lib/plugin-pages.ts and plugin-page.tsx), against this server's plugin library, its plugin
 * settings and two pages a plugin's web half contributes, behind the fetch fake.
 *
 * - An admin's rail ends with a Plugins group: the host's own plugin sources, module requests and
 *   Agent sandbox pages first, then a page for the plugin whose server module declares a settings
 *   group and one for the plugin whose web half contributes pages, named by the library. The
 *   server group keeps no plugin page.
 * - While requests wait on this server, the module requests row counts them under a name that
 *   says so, and its page lists them; plugin sources lists none.
 * - A member's rail holds only the plugin page with a part for every viewer, and the dialog never
 *   asks for the plugin settings.
 * - A request naming a contributed page by the key it had of its own opens its plugin's page,
 *   headed by the plugin's name and version; an admin sees its personal and server parts under
 *   their headings, a member the personal part alone, bare.
 * - Until the plugin pages are known, a request for one shows no other page in its place.
 * - Old keys land where their settings went: the plugins key on plugin sources; plugin sources
 *   focused on the sandbox (the composer's link before this page existed), and the sandbox key,
 *   on the Agent sandbox page.
 * - On the Agent sandbox page the sandbox's switch still saves, alone, to the sandbox's group; a
 *   backend's line links to its plugin's page, which the link opens.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type {
  MeResponse,
  PluginConfigEntry,
  PluginItem,
  PluginModuleRequestsResponse,
} from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { SettingsDialog } from "../src/features/settings/settings-dialog";
import { setContributedSections } from "../src/features/settings/contributed-sections";
import { AuthProvider } from "../src/state/auth";
import { ADMIN_ME } from "./helpers/admin-settings";
import { apiError, json, stubFetch, type FakeFetch } from "./helpers/fetch";
import {
  button,
  click,
  hasButton,
  mount,
  settle,
  switchNamed,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const BROWSER = "@acme/browser";
const HELPER = "@acme/helper";

const MEMBER_ME: MeResponse = {
  ...ADMIN_ME,
  user: { ...ADMIN_ME.user, userId: "mia", isAdmin: false },
};

const item = (pkg: string, title: string): PluginItem => ({
  name: pkg.split("/")[1]!,
  package: pkg,
  title,
  description: `What ${title} does.`,
  version: "1.2.3",
  source: "builtin",
  skills: [],
  hooks: [],
  mcpServers: [],
});

const ENTRIES: PluginConfigEntry[] = [
  {
    name: "sandbox",
    configuration: {
      title: "Agent Sandbox",
      switch: "enabled",
      properties: { enabled: { type: "boolean", title: "Enable" } },
    },
    values: { enabled: false },
    report: {
      checks: [
        {
          id: "acme-backend",
          label: "Acme Helper",
          state: "ok",
          text: "In use",
          page: `plugin:${HELPER}`,
        },
      ],
    },
  },
  {
    name: "acme-helper",
    plugin: HELPER,
    configuration: { title: "Acme Helper", properties: {} },
    values: {},
  },
];

/** One member's request to run a plugin's server module, waiting. */
const WAITING: PluginModuleRequestsResponse = {
  pending: 1,
  requests: [
    {
      package: "@acme/charts",
      plugin: "charts",
      projectId: "proj",
      projectName: "Research",
      agentId: "helper",
      requestedBy: "alice",
      requestedByName: "Alice",
      requestedAt: "2026-11-19T08:00:00.000Z",
      decision: null,
      decidedBy: null,
      decidedAt: null,
      via: null,
      builtin: false,
      state: "off",
      onServer: true,
    },
  ],
};

/**
 * This server: who is signed in, its library, its plugin settings (the library may be held), and
 * its module requests (none known unless given).
 */
function server(
  me: MeResponse,
  opts: { holdLibrary?: boolean; requests?: PluginModuleRequestsResponse } = {},
) {
  let releaseLibrary: () => void = () => {};
  const held = new Promise<void>((resolve) => (releaseLibrary = resolve));
  const fetch: FakeFetch = stubFetch(async (request) => {
    if (request.path === "/api/me") return json(me);
    if (request.path === "/api/plugins") {
      if (opts.holdLibrary === true) await held;
      return json({
        groups: [
          {
            id: "other",
            title: "Other",
            plugins: [item(BROWSER, "Acme Browser"), item(HELPER, "Acme Helper")],
          },
        ],
      });
    }
    if (request.path === "/api/admin/plugin-config" && request.method === "PUT") {
      const body = request.body as { name: string; values: Record<string, unknown> };
      const stored = ENTRIES.map((e) =>
        e.name === body.name ? { ...e, values: { ...e.values, ...body.values } } : e,
      );
      return json({ plugins: stored });
    }
    if (request.path === "/api/admin/plugin-modules" && opts.requests !== undefined) {
      return json(opts.requests);
    }
    if (request.path === "/api/admin/plugin-config") {
      return me.user.isAdmin ? json({ plugins: ENTRIES }) : apiError(403, "forbidden");
    }
    return apiError(404, "not_found");
  });
  return { fetch, releaseLibrary };
}

const Body = (text: string) => () => h("p", null, text);

function contribute() {
  setContributedSections([
    {
      from: "AcmeBrowserWeb",
      data: {
        key: "acmeBrowser",
        group: "plugin",
        plugin: BROWSER,
        visibility: "everyone",
        icon: "appWindow",
        order: 10,
      },
      code: { label: () => "Browser", Body: Body("Backend and paired browsers") },
    },
    {
      from: "AcmeBrowserWeb",
      data: {
        key: "acmeExtension",
        group: "plugin",
        plugin: BROWSER,
        visibility: "admin",
        icon: "plug",
        order: 20,
      },
      code: { label: () => "Extension", Body: Body("Allow extension connections") },
    },
  ]);
}

async function open(section?: string, pluginFocus?: string) {
  await mount(
    h(
      AuthProvider,
      null,
      h(SettingsDialog, {
        open: true,
        onClose: () => {},
        ...(section !== undefined ? { section: section as never } : {}),
        ...(pluginFocus !== undefined ? { pluginFocus } : {}),
      }),
    ),
  );
}

/** The rail: each group's heading, then its rows, top to bottom. */
const rail = () =>
  [...document.querySelectorAll("nav p.ui-eyebrow, nav button")].map((e) =>
    e.tagName === "P" ? `# ${e.textContent}` : (e.textContent ?? ""),
  );
const heading = () => document.querySelector("h2")?.textContent ?? "";
const partHeadings = () =>
  [...document.querySelectorAll("h3")].map((e) => e.textContent?.trim() ?? "");

describe("the Settings dialog's plugin pages", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    setContributedSections([]);
    await unmountAll();
  });

  it("ends an admin's rail with a page per plugin, named by the library", async () => {
    contribute();
    server(ADMIN_ME);
    await open();
    await waitFor(() => rail().includes("Acme Helper"));
    const rows = rail();
    expect(rows.slice(rows.indexOf("# Server"), rows.indexOf("# Plugins"))).not.toContain(
      "Plugin sources",
    );
    expect(rows.slice(rows.indexOf("# Plugins"))).toEqual([
      "# Plugins",
      "Plugin sources",
      "Module requests",
      "Agent Sandbox",
      "Acme Browser",
      "Acme Helper",
    ]);
    expect(rows).not.toContain("Browser");
    expect(rows).not.toContain("Extension");
  });

  it("counts the requests waiting on this server on their row, and lists them on their own page", async () => {
    server(ADMIN_ME, { requests: WAITING });
    await open();
    await waitFor(() => hasButton("Module requests, 1 waiting"));
    expect(button("Module requests, 1 waiting").textContent).toBe("Module requests1");
    await click(button("Plugin sources"));
    await waitFor(() => heading().includes("Plugin sources"));
    expect(document.body.textContent).not.toContain("Research");
    await click(button("Module requests, 1 waiting"));
    await waitFor(() => document.body.textContent?.includes("Research") === true);
    expect(heading()).toContain("Module requests");
    expect(hasButton("Enable charts")).toBe(true);
  });

  it("gives a member only the page with a part for every viewer, and never reads plugin settings", async () => {
    contribute();
    const { fetch } = server(MEMBER_ME);
    await open();
    await waitFor(() => rail().includes("Acme Browser"));
    const rows = rail();
    expect(rows.slice(rows.indexOf("# Plugins"))).toEqual(["# Plugins", "Acme Browser"]);
    expect(fetch.requests.some((r) => r.path === "/api/admin/plugin-config")).toBe(false);
  });

  it("opens a plugin's page for its contributed page's old key, with both parts for an admin", async () => {
    contribute();
    server(ADMIN_ME);
    await open("acmeExtension");
    await waitFor(() => heading().includes("Acme Browser"));
    expect(heading()).toContain("v1.2.3");
    expect(partHeadings()).toEqual(["Personal", "Server"]);
    expect(document.body.textContent).toContain("Backend and paired browsers");
    expect(document.body.textContent).toContain("Allow extension connections");
  });

  it("opens the personal part alone, bare, for a member", async () => {
    contribute();
    server(MEMBER_ME);
    await open("acmeBrowser");
    await waitFor(() => heading().includes("Acme Browser"));
    expect(partHeadings()).toEqual([]);
    expect(document.body.textContent).toContain("Backend and paired browsers");
    expect(document.body.textContent).not.toContain("Allow extension connections");
  });

  it("shows no other page while the plugin pages are not known yet", async () => {
    contribute();
    const { releaseLibrary } = server(ADMIN_ME, { holdLibrary: true });
    await open(`plugin:${BROWSER}`);
    await settle();
    expect(heading()).not.toContain("Profile");
    expect(document.body.textContent).not.toContain("Backend and paired browsers");
    releaseLibrary();
    await waitFor(() => heading().includes("Acme Browser"));
  });

  it.each([
    ["the plugins key", "plugins", undefined, "Plugin sources"],
    ["plugin sources focused on the sandbox", "plugins", "sandbox", "Agent Sandbox"],
    ["the sandbox key", "sandbox", undefined, "Agent Sandbox"],
  ])("lands %s on the page its settings moved to", async (_, section, focus, page) => {
    server(ADMIN_ME);
    await open(section, focus);
    await waitFor(() => heading().includes(page));
    expect(heading()).toContain(page);
  });

  it("saves the sandbox's switch alone on the Agent sandbox page, and links a backend to its plugin's page", async () => {
    const { fetch } = server(ADMIN_ME);
    await open("sandbox");
    await waitFor(() => document.querySelector('[data-plugin-config="sandbox"]') !== null);
    await click(switchNamed("Enable"));
    expect(
      fetch.requests
        .filter((r) => r.path === "/api/admin/plugin-config" && r.method === "PUT")
        .map((r) => r.body),
    ).toEqual([{ name: "sandbox", values: { enabled: true } }]);
    await waitFor(() => hasButton("Open"));
    await click(button("Open"));
    await waitFor(() => heading().includes("Acme Helper"));
  });
});
