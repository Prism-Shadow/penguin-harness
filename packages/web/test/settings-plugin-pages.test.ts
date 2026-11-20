// @vitest-environment jsdom
/**
 * The Settings dialog's Plugins group (features/settings/settings-dialog.tsx with
 * lib/plugin-pages.ts and plugin-page.tsx), against this server's plugin library, its plugin
 * settings and two pages a plugin's web half contributes, behind the fetch fake.
 *
 * - An admin's rail ends with a Plugins group: a page for the plugin whose server module declares
 *   a settings group and one for the plugin whose web half contributes pages, named by the
 *   library; the server's plugin page is called plugin management.
 * - A member's rail holds only the plugin page with a part for every viewer, and the dialog never
 *   asks for the plugin settings.
 * - A request naming a contributed page by the key it had of its own opens its plugin's page,
 *   headed by the plugin's name and version; an admin sees its personal and server parts under
 *   their headings, a member the personal part alone, bare.
 * - Until the plugin pages are known, a request for one shows no other page in its place.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { MeResponse, PluginConfigEntry, PluginItem } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { SettingsDialog } from "../src/features/settings/settings-dialog";
import { setContributedSections } from "../src/features/settings/contributed-sections";
import { AuthProvider } from "../src/state/auth";
import { ADMIN_ME } from "./helpers/admin-settings";
import { apiError, json, stubFetch, type FakeFetch } from "./helpers/fetch";
import { mount, settle, unmountAll, waitFor } from "./helpers/dom";

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
  { name: "sandbox", configuration: { title: "Sandbox", properties: {} }, values: {} },
  {
    name: "acme-helper",
    plugin: HELPER,
    configuration: { title: "Acme Helper", properties: {} },
    values: {},
  },
];

/** This server: who is signed in, its library, its plugin settings (the library may be held). */
function server(me: MeResponse, opts: { holdLibrary?: boolean } = {}) {
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

async function open(section?: string) {
  await mount(
    h(
      AuthProvider,
      null,
      h(SettingsDialog, {
        open: true,
        onClose: () => {},
        ...(section !== undefined ? { section: section as never } : {}),
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
    await waitFor(() => rail().includes("# Plugins"));
    const rows = rail();
    expect(rows.slice(rows.indexOf("# Plugins"))).toEqual([
      "# Plugins",
      "Acme Browser",
      "Acme Helper",
    ]);
    expect(rows).toContain("Plugin admin");
    expect(rows).not.toContain("Browser");
    expect(rows).not.toContain("Extension");
  });

  it("gives a member only the page with a part for every viewer, and never reads plugin settings", async () => {
    contribute();
    const { fetch } = server(MEMBER_ME);
    await open();
    await waitFor(() => rail().includes("# Plugins"));
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
});
