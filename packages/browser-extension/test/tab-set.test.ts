/**
 * Which tabs a server may drive, and what it hears about them.
 *
 * - Given an `open-tab`, the new tab opens in the last focused window, inside a group titled
 *   "Penguin" (blue), and the server hears about it; the next one joins the same group.
 * - Given two paired servers, each gets its own group, titled "Penguin · <server>".
 * - Given a page a driven tab opens, it joins its opener's server and group; a page an undriven
 *   tab opens is not adopted.
 * - Given a driven tab opens a page into a popup window (which holds no groups), the page is
 *   driven without a group.
 * - Given the user drags a driven tab out of its group, its server hears `tab-released (user)`
 *   and stops driving it; the group change the extension's own grouping causes is not mistaken
 *   for that.
 * - Given the debugger's Cancel, every driven tab is released but stays in its group; telling
 *   it again says nothing new; closing such a tab says nothing more either.
 * - Given a released tab the user hands over again, the server may drive it again.
 * - Given the user takes a tab back from the popup, the server hears it and the tab leaves the
 *   group.
 * - Given a driven tab closes, only its own server hears `tab-closed` (and not a release, though
 *   Chrome takes a closing tab out of its group first).
 * - Given one server, another server can neither list, close nor focus its tabs.
 * - Given a server is forgotten (revoked or removed), its tabs leave their groups and stop
 *   being driven; the other server's tabs stay.
 * - Given a worker restart, the stored set comes back without the tabs and groups Chrome no
 *   longer has, and a malformed stored set is dropped rather than trusted.
 * - Given exactly one paired server, a click on an ordinary tab hands it over; with several
 *   servers, on a driven or restricted tab, or while paused, the click opens the popup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drivenTabs, lookup, parseTabSet } from "../src/tab-set.js";
import { TabController } from "../src/tabs.js";
import { POPUP_PAGE, popupFor } from "../src/toolbar.js";
import type { DesktopBrowserEvent } from "../src/wire.js";
import { installChrome, type FakeChrome } from "./helpers/chrome.js";

const A = "https://ph.example.com";
const B = "http://localhost:7369";

let fake: FakeChrome;
let windowId: number;

function controller(servers: Record<string, string> = { [A]: "ph.example.com" }) {
  const heard: { server: string; event: DesktopBrowserEvent }[] = [];
  const detached: number[] = [];
  const many = Object.keys(servers).length > 1;
  const tabs = new TabController({
    send: (server, event) => heard.push({ server, event }),
    detach: (tabId) => detached.push(tabId),
    groupTitle: (server) => (many ? `Penguin · ${servers[server]}` : "Penguin"),
  });
  fake.events.tabUpdated.addListener((tabId, change, tab) =>
    tabs.onUpdated(tabId, change as chrome.tabs.OnUpdatedInfo, tab as chrome.tabs.Tab),
  );
  fake.events.tabRemoved.addListener((tabId) => tabs.onRemoved(tabId));
  fake.events.groupRemoved.addListener((group) =>
    tabs.onGroupRemoved((group as { id: number }).id),
  );
  const kinds = (server: string) =>
    heard.filter((h) => h.server === server).map((h) => `${h.event.kind}:${tabIdOf(h.event)}`);
  return { tabs, heard, detached, kinds };
}

function tabIdOf(event: DesktopBrowserEvent): number | undefined {
  if (event.kind === "tab") return event.tab.id;
  return "tabId" in event ? event.tabId : undefined;
}

/** Lets the controller's effect queue run to the end (a macrotask drains every microtask). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fake = installChrome();
  windowId = fake.addWindow().id;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tabs a server opens", () => {
  it("opens in the last focused window, inside a blue Penguin group, announced to the server", async () => {
    const { tabs, kinds } = controller();
    const first = await tabs.open(A, "https://shop.example.com/", true);
    const second = await tabs.open(A, "https://mail.example.com/", false);

    const groupIds = new Set([first.id, second.id].map((id) => fake.tabs.get(id)!.groupId));
    expect(groupIds.size).toBe(1);
    const [groupId] = [...groupIds];
    expect(fake.groups.get(groupId!)).toMatchObject({ windowId, title: "Penguin", color: "blue" });
    expect(first).toMatchObject({ url: "https://shop.example.com/", loading: true });
    expect(kinds(A)).toEqual([`tab:${first.id}`, `tab:${second.id}`]);
  });

  it("gives each paired server its own group, named after it", async () => {
    const { tabs } = controller({ [A]: "ph.example.com", [B]: "localhost:7369" });
    const a = await tabs.open(A, "https://shop.example.com/", false);
    const b = await tabs.open(B, "https://news.example.com/", false);
    const groupOf = (id: number) => fake.groups.get(fake.tabs.get(id)!.groupId);
    expect(groupOf(a.id)?.title).toBe("Penguin · ph.example.com");
    expect(groupOf(b.id)?.title).toBe("Penguin · localhost:7369");
  });

  it("drives a page opened into a popup window without a group", async () => {
    const { tabs } = controller();
    const opener = await tabs.open(A, "https://shop.example.com/", true);
    const popupWindow = fake.addWindow("popup");
    const popup = fake.openTab({ windowId: popupWindow.id, url: "https://pay.example.com/" });
    await tabs.onCreatedNavigationTarget(opener.id, popup.id);
    expect(fake.tabs.get(popup.id)!.groupId).toBe(-1);
    expect(drivenTabs(tabs.snapshot, A).map((t) => t.tabId)).toEqual([opener.id, popup.id]);
  });
});

describe("pages a driven tab opens", () => {
  it("joins its opener's server and group; one an undriven tab opens does not", async () => {
    const { tabs, kinds } = controller();
    const opener = await tabs.open(A, "https://shop.example.com/", true);
    const popup = fake.openTab({ windowId, url: "https://shop.example.com/help" });
    await tabs.onCreatedNavigationTarget(opener.id, popup.id);

    const stranger = fake.openTab({ windowId, url: "https://bank.example.com/" });
    const strangersPopup = fake.openTab({ windowId, url: "https://bank.example.com/statement" });
    await tabs.onCreatedNavigationTarget(stranger.id, strangersPopup.id);

    expect(fake.tabs.get(popup.id)!.groupId).toBe(fake.tabs.get(opener.id)!.groupId);
    expect(kinds(A)).toEqual([`tab:${opener.id}`, `tab:${popup.id}`]);
    expect(lookup(tabs.snapshot, strangersPopup.id)).toBeUndefined();
  });
});

describe("taking tabs back", () => {
  it("a tab dragged out of its group is released to its server and no longer driven", async () => {
    const { tabs, kinds, detached } = controller();
    const tab = await tabs.open(A, "https://shop.example.com/", true);
    fake.ungroupByUser(tab.id);
    await settle();
    expect(kinds(A)).toEqual([`tab:${tab.id}`, `tab-released:${tab.id}`]);
    expect(lookup(tabs.snapshot, tab.id)).toBeUndefined();
    expect(detached).toEqual([tab.id]);
  });

  it("the debugger's Cancel releases every tab but leaves them in their group", async () => {
    const { tabs, heard, kinds } = controller({ [A]: "a", [B]: "b" });
    const a = await tabs.open(A, "https://shop.example.com/", true);
    const b = await tabs.open(B, "https://news.example.com/", true);
    await tabs.releaseAll("user");
    await tabs.releaseAll("user");

    expect(kinds(A)).toEqual([`tab:${a.id}`, `tab-released:${a.id}`]);
    expect(kinds(B)).toEqual([`tab:${b.id}`, `tab-released:${b.id}`]);
    expect(heard.find((h) => h.event.kind === "tab-released")?.event).toEqual({
      kind: "tab-released",
      tabId: a.id,
      reason: "user",
    });
    expect(fake.tabs.get(a.id)!.groupId).not.toBe(-1);
    expect(() => tabs.drivable(A, a.id)).toThrow("tab_released");

    fake.closeTab(a.id);
    await settle();
    expect(kinds(A)).toEqual([`tab:${a.id}`, `tab-released:${a.id}`]);
  });

  it("a released tab the user hands over again can be driven again", async () => {
    const { tabs } = controller();
    const tab = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.release([tab.id], "user");
    await expect(tabs.adopt(A, tab.id)).resolves.toBe("adopted");
    await settle();
    expect(tabs.drivable(A, tab.id).tabId).toBe(tab.id);
    expect(fake.tabs.get(tab.id)!.groupId).not.toBe(-1);
  });

  it("the popup's Release tells the server and takes the tab out of the group", async () => {
    const { tabs, kinds } = controller();
    const tab = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.giveBack(tab.id);
    await settle();
    expect(kinds(A)).toEqual([`tab:${tab.id}`, `tab-released:${tab.id}`]);
    expect(fake.tabs.get(tab.id)!.groupId).toBe(-1);
    expect(lookup(tabs.snapshot, tab.id)).toBeUndefined();
  });

  it("a page Chrome does not let extensions drive cannot be handed over", async () => {
    const { tabs } = controller();
    const settings = fake.openTab({ windowId, url: "chrome://settings/" });
    await expect(tabs.adopt(A, settings.id)).resolves.toBe("restricted");
    expect(lookup(tabs.snapshot, settings.id)).toBeUndefined();
  });
});

describe("one server's tabs are its own", () => {
  it("a closed tab is reported to its own server only", async () => {
    const { tabs, kinds } = controller({ [A]: "a", [B]: "b" });
    const a = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.open(B, "https://news.example.com/", true);
    fake.closeTab(a.id);
    await settle();
    expect(kinds(A)).toEqual([`tab:${a.id}`, `tab-closed:${a.id}`]);
    expect(kinds(B).some((k) => k.startsWith("tab-closed"))).toBe(false);
  });

  it("another server can neither list, close nor focus them, and the user's own tabs are invisible", async () => {
    const { tabs } = controller({ [A]: "a", [B]: "b" });
    const a = await tabs.open(A, "https://shop.example.com/", true);
    const own = fake.openTab({ windowId, url: "https://bank.example.com/" });
    expect((await tabs.list(B)).map((t) => t.id)).toEqual([]);
    expect((await tabs.list(A)).map((t) => t.id)).toEqual([a.id]);
    await expect(tabs.close(B, a.id)).rejects.toThrow("no_such_tab");
    await expect(tabs.activate(B, a.id)).rejects.toThrow("no_such_tab");
    await expect(tabs.close(A, own.id)).rejects.toThrow("no_such_tab");
    expect(fake.tabs.has(a.id)).toBe(true);
  });

  it("forgetting a server ungroups and drops its tabs, and only its tabs", async () => {
    const { tabs } = controller({ [A]: "a", [B]: "b" });
    const a = await tabs.open(A, "https://shop.example.com/", true);
    const b = await tabs.open(B, "https://news.example.com/", true);
    await tabs.forgetServer(A);
    expect(fake.tabs.get(a.id)!.groupId).toBe(-1);
    expect(fake.tabs.has(a.id)).toBe(true);
    expect(lookup(tabs.snapshot, a.id)).toBeUndefined();
    expect(tabs.drivable(B, b.id).tabId).toBe(b.id);
  });
});

describe("a worker restart", () => {
  it("brings back the stored set without what Chrome no longer has", async () => {
    const { tabs } = controller();
    const kept = await tabs.open(A, "https://shop.example.com/", true);
    const gone = await tabs.open(A, "https://news.example.com/", true);
    const stored = JSON.parse(JSON.stringify(tabs.snapshot));
    fake.tabs.delete(gone.id);

    const restored = await TabController.restore(parseTabSet(stored));
    expect(Object.keys(restored.tabs)).toEqual([String(kept.id)]);
    expect(Object.values(restored.groups)).toEqual([fake.tabs.get(kept.id)!.groupId]);
  });

  it("drops a malformed stored set rather than trusting it", () => {
    const parsed = parseTabSet({
      tabs: {
        "1": { tabId: 1, server: A, windowId: 1, how: "created" },
        "2": { tabId: "2", server: A, windowId: 1, how: "created" },
        "3": { tabId: 3, server: A, windowId: 1, how: "stolen" },
      },
      groups: { [`1 ${A}`]: 7, nonsense: "x" },
    });
    expect(Object.keys(parsed.tabs)).toEqual(["1"]);
    expect(parsed.groups).toEqual({ [`1 ${A}`]: 7 });
  });
});

describe("handing a tab over with the toolbar icon", () => {
  const ordinary = {
    url: "https://shop.example.com/",
    driven: false,
    servers: 1,
    attention: false,
    paused: false,
  };

  it("hands an ordinary tab over at once when exactly one server is paired", () => {
    expect(popupFor(ordinary)).toBe("");
  });

  it.each([
    ["the tab is already handed over", { driven: true }],
    ["the page is chrome://", { url: "chrome://extensions/" }],
    ["several servers are paired", { servers: 2 }],
    ["another Chrome took the connection over", { attention: true }],
    ["the extension is paused", { paused: true }],
  ])("opens the popup instead when %s", (_name, change) => {
    expect(popupFor({ ...ordinary, ...change })).toBe(POPUP_PAGE);
  });
});
