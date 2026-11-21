// @vitest-environment jsdom
/**
 * Settings › Plugins, the administrator's server module requests
 * (features/settings/plugin-module-requests.tsx), against the HTTP fake: what the ledger lists,
 * and a decision answered with the new list.
 *
 * - Given a member's waiting request, its row names the plugin, the Project and the member, and
 *   offers Enable and Decline; enabling posts the decision for that package and the row then
 *   reads as approved, with Stop in place of the two.
 * - Given a waiting request whose Project is gone, the row offers Decline alone.
 * - Given an enabled module, Stop asks first, saying that the Agents' Skills are not affected;
 *   cancelling sends nothing, confirming declines the package and the row then reads declined
 *   with Enable.
 * - Given a stop the server answers with Projects whose shared table still lists the module, the
 *   toast names them.
 * - Given no request at all, the section says nothing waits.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  PluginModuleRequest,
  PluginModuleRequestsResponse,
} from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { PluginModuleRequests } from "../src/features/settings/plugin-module-requests";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { LocaleProvider } from "../src/state/locale";
import {
  button,
  click,
  dialogs,
  hasButton,
  mount,
  pressScrim,
  unmountAll,
  waitFor,
} from "./helpers/dom";
import { apiError, json, stubFetch, type FakeFetch } from "./helpers/fetch";

const words = en.settings.moduleRequests;

const request = (over: Partial<PluginModuleRequest>): PluginModuleRequest => ({
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
  ...over,
});

/** The server: the ledger it holds, the library naming each plugin, and what a decision does. */
function server(initial: PluginModuleRequest[], stillListed?: string[]): FakeFetch {
  let rows = initial;
  const ledger = (extra: Partial<PluginModuleRequestsResponse> = {}) =>
    json({ requests: rows, pending: rows.filter((r) => r.decision === null).length, ...extra });
  return stubFetch((r) => {
    if (r.path === "/api/admin/plugin-modules" && r.method === "GET") return ledger();
    if (r.path === "/api/admin/plugin-modules/decide" && r.method === "POST") {
      const { package: pkg, decision } = r.body as { package: string; decision: string };
      rows = rows.map((row) =>
        row.package !== pkg
          ? row
          : decision === "enable"
            ? { ...row, decision: "enabled", via: "approval", state: "running" }
            : { ...row, decision: "declined", state: "off" },
      );
      return ledger(
        stillListed !== undefined
          ? { stillListedBy: stillListed.map((name) => ({ projectId: name, projectName: name })) }
          : {},
      );
    }
    if (r.path === "/api/plugins") {
      return json({
        groups: [
          {
            id: "all",
            title: "All",
            plugins: [{ name: "charts", title: "Charts", skills: [], hooks: [], mcpServers: [] }],
          },
        ],
      });
    }
    return apiError(404, "not_found");
  });
}

const decisions = (fake: FakeFetch) =>
  fake.requests.filter((r) => r.path === "/api/admin/plugin-modules/decide").map((r) => r.body);

const rowText = () => document.querySelector(`ul[aria-label="${words.title}"]`)?.textContent ?? "";
const toasts = () => toastStore.getState().items.map((t) => t.text);

const open = () => mount(h(LocaleProvider, null, h(PluginModuleRequests, { machine: null })));

describe("the administrator's server module requests", () => {
  beforeEach(() => {
    setActiveStrings(en);
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    setActiveStrings(zh);
  });

  it("enables a member's waiting request, which then reads as approved with Stop", async () => {
    const fake = server([request({})]);
    await open();
    await waitFor(() => rowText().includes("Charts"));
    expect(rowText()).toContain("Research");
    expect(rowText()).toContain("Alice");
    expect(rowText()).toContain(words.waiting);
    expect(hasButton(`${words.decline} Charts`)).toBe(true);

    await click(button(`${words.enable} Charts`));
    await waitFor(() => rowText().includes(words.via.approval));
    expect(decisions(fake)).toEqual([{ package: "@acme/charts", decision: "enable" }]);
    expect(hasButton(`${words.stop} Charts`)).toBe(true);
    expect(hasButton(`${words.decline} Charts`)).toBe(false);
    expect(toasts()).toEqual([words.enabledToast("Charts")]);
  });

  it("offers only Decline for a request whose Project is gone", async () => {
    server([request({ projectId: null, projectName: null })]);
    await open();
    await waitFor(() => rowText().includes(words.projectGone));
    expect(hasButton(`${words.decline} Charts`)).toBe(true);
    expect(hasButton(`${words.enable} Charts`)).toBe(false);
  });

  it("asks before stopping an enabled module, then declines it", async () => {
    const fake = server([
      request({ decision: "enabled", via: "builtin", state: "running", builtin: true }),
    ]);
    await open();
    await waitFor(() => rowText().includes(words.via.builtin));

    await click(button(`${words.stop} Charts`));
    expect(dialogs().at(-1)?.textContent).toContain(words.stopBody("Charts"));
    await pressScrim();
    await waitFor(() => dialogs().length === 0);
    expect(decisions(fake)).toEqual([]);

    await click(button(`${words.stop} Charts`));
    const confirm = [...(dialogs().at(-1)?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === words.stop,
    );
    await click(confirm!);
    await waitFor(() => rowText().includes(words.declined));
    expect(decisions(fake)).toEqual([{ package: "@acme/charts", decision: "decline" }]);
    expect(hasButton(`${words.enable} Charts`)).toBe(true);
    expect(toasts()).toEqual([words.stoppedToast("Charts")]);
  });

  it("names the Projects whose shared table keeps a stopped module running", async () => {
    server([request({ decision: "enabled", via: "admin", state: "running" })], ["Lab", "Ops"]);
    await open();
    await waitFor(() => rowText().includes(words.via.admin));
    await click(button(`${words.stop} Charts`));
    const confirm = [...(dialogs().at(-1)?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === words.stop,
    );
    await click(confirm!);
    await waitFor(() => toasts().length === 1);
    expect(toasts()).toEqual([words.stillListed("Charts", `Lab${words.sep}Ops`)]);
  });

  it("says nothing waits when the ledger is empty", async () => {
    server([]);
    await open();
    await waitFor(() => document.body.textContent?.includes(words.empty) === true);
  });
});
