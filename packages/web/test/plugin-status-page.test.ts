// @vitest-environment jsdom
/**
 * A settings group on its plugin's page, drawn as a status page (features/settings/
 * plugin-group-page.tsx through plugin-config-card.tsx's page layout), from what its status
 * reports (`report`) and what it declares.
 *
 * - The version element shows the program's name, version and platform with its state in words,
 *   and offers the action the report places on it; while preparing it shows how far it has got.
 * - The summary is a pill in words.
 * - The checks are one list: each row names what is checked, says its state to assistive
 *   technology, says what was found, carries its own action, and keeps a tool's words folded
 *   until asked for; the one "check again" sits at the list's heading.
 * - An action the report places on an element is drawn there only; the others are the page's
 *   primary actions; each button hands its action to the settings page, which decides whether
 *   to ask (plugin-page-actions.test.ts). With no checks, "check again" is a primary action.
 * - A state this page has no word for (a newer plugin's, through an older server) draws as not
 *   known under the plugin's own value, never breaking the page.
 * - Fields marked as security settings sit under their own heading, apart from the options;
 *   advanced ones stay folded.
 * - While the group's switch is off, only the switch is drawn: no status, no checks.
 * - A group whose status reports only notices and actions (the old shape) shows its notices and
 *   its actions, and no checks.
 * - In Chinese, the plugin's Chinese words and the page's own Chinese words are shown.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h, useState } from "react";
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PluginCard } from "../src/features/settings/plugin-config-card";
import { button, click, hasButton, mount, unmountAll } from "./helpers/dom";
import { stubFetch } from "./helpers/fetch";

const ENTRY: PluginConfigEntry = {
  name: "acme-helper",
  plugin: "@acme/helper",
  configuration: {
    title: "Acme Helper",
    switch: "enabled",
    properties: {
      enabled: { type: "boolean", title: "Acme Helper", default: true },
      verbose: { type: "boolean", title: "Verbose logs" },
      members: { type: "boolean", title: "Allow members", titleZh: "允许成员使用", security: true },
      path: { type: "string", title: "Program path", advanced: true },
    },
  },
  values: { enabled: true, verbose: false, members: false, path: "" },
  report: {
    summary: { state: "attention", text: "Needs setup", textZh: "需要设置" },
    version: {
      name: "acme-desktop",
      state: "failed",
      version: "1.3.1",
      platform: "linux-x64",
      text: "The download was refused.",
      action: "install",
    },
    checks: [
      { id: "display", label: "Display", labelZh: "显示", state: "ok", text: "X11 :93" },
      {
        id: "accessibility",
        label: "Accessibility",
        state: "action",
        text: "Not allowed yet",
        details: "No D-Bus session bus is reachable.",
        action: "guide",
      },
      { id: "wm", label: "Window manager", state: "unknown" },
      { id: "automation", label: "Automation", state: "na" },
    ],
    recheck: "check",
  },
  actions: [
    { id: "install", title: "Retry", titleZh: "重试" },
    { id: "check", title: "Check again", titleZh: "重新检查" },
    { id: "guide", title: "Open System Settings", description: "Opens Privacy & Security." },
    { id: "logs", title: "Export logs" },
  ],
  notices: [{ tone: "muted", text: "Keep the Web App closed on this desktop." }],
};

/** Every action the page hands over. */
let handed: string[] = [];

function Page({ entry, locale = "en" }: { entry: PluginConfigEntry; locale?: "en" | "zh" }) {
  const [busy, setBusy] = useState<string | null>(null);
  return h(PluginCard, {
    layout: "page",
    members: [entry],
    machine: null,
    busy,
    setBusy,
    locale,
    onStored: () => {},
    onStoredAll: () => {},
    onAction: (_entry, action) => void handed.push(action),
    onSwitchedOn: () => {},
  });
}

const text = () => document.body.textContent ?? "";
const buttons = (name: string) =>
  [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name);
const row = (id: string) => document.querySelector<HTMLElement>(`[data-check="${id}"]`)!;
const heading = (name: string) =>
  [...document.querySelectorAll("h3")]
    .find((e) => e.textContent?.includes(name))!
    .closest("section")!;

describe("a plugin's status page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    handed = [];
    await unmountAll();
  });

  it("shows the version element with its state in words, its reason and its own action", async () => {
    stubFetch();
    await mount(h(Page, { entry: ENTRY }));
    const version = document.querySelector<HTMLElement>("[data-version-state]")!;
    expect(version.dataset.versionState).toBe("failed");
    expect(version.textContent).toContain("acme-desktop");
    expect(version.textContent).toContain("1.3.1");
    expect(version.textContent).toContain("linux-x64");
    expect(version.textContent).toContain("Install failed");
    expect(version.textContent).toContain("The download was refused.");
    expect(version.querySelector("button")?.textContent).toBe("Retry");
    expect(text()).toContain("Needs setup");
  });

  it("shows how far a program being prepared has got", async () => {
    stubFetch();
    const preparing: PluginConfigEntry = {
      ...ENTRY,
      report: {
        version: { name: "acme-desktop", state: "preparing", progress: 0.25, text: "Downloading" },
      },
    };
    await mount(h(Page, { entry: preparing }));
    const bar = document.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(text()).toContain("Preparing");
  });

  it("lists every check with its state, its finding and its own action, details folded", async () => {
    stubFetch();
    await mount(h(Page, { entry: ENTRY }));
    const states = ["display", "accessibility", "wm", "automation"].map((id) =>
      row(id).querySelector('[role="img"]')!.getAttribute("aria-label"),
    );
    expect(states).toEqual(["OK", "Needs action", "Unknown", "Not applicable"]);
    expect(row("display").textContent).toContain("X11 :93");
    expect(row("accessibility").querySelector("button:last-child")?.textContent).toBe(
      "Open System Settings",
    );
    // Every row's fold reads "Details"; its name says which row it belongs to.
    const fold = button("Details");
    expect(fold.getAttribute("aria-label")).toBe("Details: Accessibility");
    const panel = document.getElementById(fold.getAttribute("aria-controls")!)!;
    expect(panel.textContent).toContain("No D-Bus session bus");
    expect(panel.hidden).toBe(true);
    await click(fold);
    expect(panel.hidden).toBe(false);
    expect(heading("Checks").querySelector("button")?.textContent).toBe("Check again");
  });

  it("draws a placed action only where it is placed, and the rest as primary actions", async () => {
    stubFetch();
    await mount(h(Page, { entry: ENTRY }));
    expect(buttons("Retry")).toHaveLength(1);
    expect(buttons("Check again")).toHaveLength(1);
    expect(buttons("Open System Settings")).toHaveLength(1);
    expect(buttons("Export logs")).toHaveLength(1);
    // An action's description is its button's hint.
    expect(button("Open System Settings").getAttribute("data-tooltip")).toBe(
      "Opens Privacy & Security.",
    );
  });

  it("hands each button's action to the settings page", async () => {
    stubFetch();
    await mount(h(Page, { entry: ENTRY }));
    await click(button("Check again"));
    await click(button("Open System Settings"));
    await click(button("Export logs"));
    await click(button("Retry"));
    expect(handed).toEqual(["check", "guide", "logs", "install"]);
  });

  it("keeps check again among the primary actions when the report has no checks", async () => {
    stubFetch();
    await mount(
      h(Page, {
        entry: {
          ...ENTRY,
          report: { version: { name: "acme-desktop", state: "preparing" }, recheck: "check" },
        },
      }),
    );
    expect(buttons("Check again")).toHaveLength(1);
    expect(document.querySelector("[data-check]")).toBeNull();
  });

  it("draws a state it has no word for as not known, under the plugin's own value", async () => {
    stubFetch();
    const skewed = {
      ...ENTRY,
      report: {
        summary: { state: "brewing", text: "Brewing" },
        version: { name: "acme-desktop", state: "updating" },
        checks: [{ id: "display", label: "Display", state: "blocked" }],
      },
    } as unknown as PluginConfigEntry;
    await mount(h(Page, { entry: skewed }));
    expect(document.querySelector("[data-version-state]")?.textContent).toContain("updating");
    expect(row("display").querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "blocked",
    );
    expect(text()).toContain("Brewing");
  });

  it("puts security settings under their own heading, and keeps advanced fields folded", async () => {
    stubFetch();
    await mount(h(Page, { entry: ENTRY }));
    expect(heading("Security").textContent).toContain("Allow members");
    expect(heading("Options").textContent).toContain("Verbose logs");
    expect(heading("Options").textContent).not.toContain("Allow members");
    expect(hasButton("Advanced")).toBe(true);
  });

  it("draws the switch alone while the group is off", async () => {
    stubFetch();
    await mount(h(Page, { entry: { ...ENTRY, values: { ...ENTRY.values, enabled: false } } }));
    expect(document.querySelector("[data-version-state]")).toBeNull();
    expect(document.querySelector("[data-check]")).toBeNull();
    expect(text()).not.toContain("Keep the Web App closed");
    expect(text()).not.toContain("Verbose logs");
    expect(hasButton("Export logs")).toBe(false);
  });

  it("shows an old-shape group's notices and actions, and no checks", async () => {
    stubFetch();
    const { report: _report, ...old } = ENTRY;
    await mount(h(Page, { entry: old }));
    expect(text()).toContain("Keep the Web App closed on this desktop.");
    expect(document.querySelector("[data-check]")).toBeNull();
    for (const action of ["Retry", "Check again", "Open System Settings", "Export logs"]) {
      expect(buttons(action)).toHaveLength(1);
    }
  });

  it("shows the plugin's Chinese words and the page's own in Chinese", async () => {
    setActiveStrings(zh);
    try {
      stubFetch();
      await mount(h(Page, { entry: ENTRY, locale: "zh" }));
      expect(row("display").textContent).toContain("显示");
      expect(text()).toContain("需要设置");
      expect(text()).toContain("安装失败");
      expect(heading("安全设置").textContent).toContain("允许成员使用");
      expect(buttons("重新检查")).toHaveLength(1);
    } finally {
      setActiveStrings(en);
    }
  });
});
