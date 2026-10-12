/**
 * The plugin import dialog: one tab per way in.
 *
 * - The dialog opens on the npm tab, with all four tabs offered, and shows only the npm tab's
 *   form: one field for the package name, and no file picker or prompt.
 * - The link tab installs an https link through the Project's plugin route, and the npm tab a
 *   package name, each sent as typed, without the spaces around it.
 * - A value a tab does not take — a package name on the link tab, a link on the npm tab — is
 *   never sent, and the field says why; a value it takes shows no reason and can be installed.
 * - A link to a folder inside a repository, pasted on the link tab, is refused at the field with
 *   an "Ask an agent" action and never sent; the action leads to the agent tab holding the link
 *   as its source, so the prompt to send carries it. No other refused value offers the action.
 * - When the server refuses the install, its reason comes back to show under the field.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ImportPluginTabs,
  installFromTab,
  type ImportOpening,
} from "../src/features/plugins/plugin-import-modal";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { LocaleProvider } from "../src/state/locale";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { stubLocalStorage } from "./helpers/storage";

beforeEach(() => {
  stubLocalStorage().setItem("penguin.lang", "en");
  setActiveStrings(en);
});

const PROJECT = "proj-1";
const ROUTE = `/api/projects/${PROJECT}/plugins/installed`;

/** What the server answers an install with: the Project's list, and what landed. */
const installed = (name: string) =>
  json({
    plugins: [],
    shipped: [],
    file: ".project_config.toml",
    machineId: "Self000000000000",
    restartPending: false,
    installed: { name, version: "1.0.0", library: true, modules: [] },
  });

/** Each tab's words and whether it is the selected one, in order. */
const TAB = /<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/gs;

/** The dialog's body as it first renders: on the npm tab with nothing typed, or where `initial` opens it. */
const render = (initial?: ImportOpening) =>
  renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(ImportPluginTabs, {
        projectId: PROJECT,
        ...(initial !== undefined ? { initial } : {}),
        onOpenChat: () => undefined,
        onLanded: () => undefined,
      }),
    ),
  );

/** The markup with its tags dropped, as a reader sees the text. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The words of the selected tab. */
const selectedTab = (html: string) =>
  [...html.matchAll(TAB)].filter((m) => m[1] === "true").map((m) => words(m[2]!))[0];

/** The active tab's panel: everything from the tabpanel on. */
const panelOf = (html: string) => html.slice(html.indexOf('role="tabpanel"'));

/** Every button in the markup, by its words, and whether it is disabled. */
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].map((m) => ({
    words: words(m[2]!),
    disabled: m[1]!.includes('disabled=""'),
  }));

describe("the import dialog's tabs", () => {
  it("opens on the npm tab, offering all four, and shows only the npm tab's form", () => {
    const html = render();
    const tabs = [...html.matchAll(TAB)].map((m) => [m[2]!.replace(/<[^>]+>/g, ""), m[1]]);
    expect(tabs).toEqual([
      [en.plugins.importTabs.npm, "true"],
      [en.plugins.importTabs.link, "false"],
      [en.plugins.importTabs.zip, "false"],
      [en.plugins.importTabs.agent, "false"],
    ]);
    const panel = html.slice(html.indexOf('role="tabpanel"'));
    expect(panel).toContain(`aria-label="${en.plugins.importNpmLabel}"`);
    expect(panel.match(/<input/g)).toHaveLength(1);
    expect(panel).not.toContain('type="file"');
    expect(panel).not.toContain("<textarea");
  });
});

describe("installing from the npm and the link tab", () => {
  it("installs a link from the link tab and a package name from the npm tab through the plugin route", async () => {
    const fetch = stubFetch((request) =>
      installed((request.body as { specifier: string }).specifier),
    );
    const link = await installFromTab(PROJECT, "link", "  https://github.com/acme/notes ");
    const name = await installFromTab(PROJECT, "npm", " @acme/notes@1.0.0");
    expect([link?.kind, name?.kind]).toEqual(["installed", "installed"]);
    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", ROUTE, { specifier: "https://github.com/acme/notes" }],
      ["POST", ROUTE, { specifier: "@acme/notes@1.0.0" }],
    ]);
  });

  it("never sends a package name from the link tab, or a link from the npm tab", async () => {
    const fetch = stubFetch(() => installed("@acme/notes"));
    expect(await installFromTab(PROJECT, "link", "@acme/notes")).toBeNull();
    expect(await installFromTab(PROJECT, "npm", "https://github.com/acme/notes")).toBeNull();
    expect(await installFromTab(PROJECT, "link", "http://example.com/notes.tgz")).toBeNull();
    expect(fetch.requests).toEqual([]);
  });

  it("hands back the server's reason when it refuses the install", async () => {
    stubFetch(() => apiError(400, "plugin_install_failed", "npm: 404 Not Found - @acme/nope"));
    expect(await installFromTab(PROJECT, "npm", "@acme/nope")).toEqual({
      kind: "refused",
      message: expect.stringContaining("404 Not Found"),
    });
  });

  it("says at the field why it refuses any other value, without offering an agent, and enables Install only for a value it takes", () => {
    const reasons = [
      en.plugins.importNpmInvalid,
      en.plugins.importLinkInvalid,
      en.plugins.importLinkSubpath,
    ];
    const cases: [ImportOpening, string | null][] = [
      [{ tab: "npm", value: "https://github.com/acme/notes" }, en.plugins.importNpmInvalid],
      [{ tab: "link", value: "http://example.com/notes.tgz" }, en.plugins.importLinkInvalid],
      [{ tab: "link", value: "https://github.com/acme/notes" }, null],
    ];
    for (const [opening, reason] of cases) {
      const panel = panelOf(render(opening));
      expect(
        reasons.filter((r) => words(panel).includes(r)),
        opening.value,
      ).toEqual(reason === null ? [] : [reason]);
      expect(buttons(panel).map((b) => b.words)).not.toContain(en.plugins.importLinkAskAgent);
      expect(buttons(panel).find((b) => b.words === en.plugins.install)?.disabled).toBe(
        reason !== null,
      );
    }
  });
});

describe("a repository folder on the link tab", () => {
  const FOLDER = "https://github.com/acme/plugins/tree/main/plugins/notes";

  it("is refused at the field, never sent, and Ask an agent carries it to the agent tab with the value", async () => {
    const linkTab = render({ tab: "link", value: FOLDER });
    expect(selectedTab(linkTab)).toBe(en.plugins.importTabs.link);
    const panel = panelOf(linkTab);
    expect(words(panel)).toContain(en.plugins.importLinkSubpath);
    expect(words(panel)).not.toContain(en.plugins.importLinkInvalid);
    const shown = buttons(panel);
    expect(shown.find((b) => b.words === en.plugins.importLinkAskAgent)?.disabled).toBe(false);
    expect(shown.find((b) => b.words === en.plugins.install)?.disabled).toBe(true);

    const fetch = stubFetch(() => installed("notes"));
    expect(await installFromTab(PROJECT, "link", FOLDER)).toBeNull();
    expect(fetch.requests).toEqual([]);

    // Where Ask an agent leads: the agent tab holding the link, in the prompt there is to send.
    const agentTab = render({ tab: "agent", value: FOLDER });
    expect(selectedTab(agentTab)).toBe(en.plugins.importTabs.agent);
    const prompt = /<textarea[^>]*>(.*?)<\/textarea>/s.exec(agentTab)?.[1] ?? "";
    expect(prompt).toContain(FOLDER);
    expect(prompt).toContain("plugin-porting");
  });
});
