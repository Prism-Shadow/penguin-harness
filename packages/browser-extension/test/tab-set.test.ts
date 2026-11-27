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
 * - Given a size for a tab, the tab moves out of the user's window into a window of its own,
 *   still driven and in its server's group there, and that window is sized so the page is that
 *   size; the user's window and its other tabs stay as they were. A tab already alone in such a
 *   window is sized where it is. Chrome's limits (the screen) give the size Chrome could give,
 *   and a window Chrome refuses leaves the size the page had; a window the user maximized is
 *   made normal again. The server's new tabs keep opening in the
 *   user's window. Dragging the sized tab out still releases it, and a tab the server may not
 *   drive is refused without anything moving.
 * - Given a worker restart, the stored set comes back without the tabs, groups and windows
 *   Chrome no longer has; a malformed stored set is dropped rather than trusted, and one stored
 *   before tabs could be sized is read as having no windows of the extension's own.
 * - Given exactly one paired server, a click on an ordinary tab hands it over; with several
 *   servers, on a driven or restricted tab, or while paused, the click opens the popup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drivenTabs, isOwnWindow, lookup, parseTabSet } from "../src/tab-set.js";
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
  fake.events.windowRemoved.addListener((id) => tabs.onWindowRemoved(id));
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

describe("a tab given a size", () => {
  /** A tab of the user's own, so their window stays open when a driven tab leaves it. */
  const userTab = () => fake.openTab({ windowId, url: "https://bank.example.com/" });
  const windowOf = (tabId: number) => fake.tabs.get(tabId)!.windowId;
  const tabsIn = (id: number) =>
    [...fake.tabs.values()].filter((tab) => tab.windowId === id).map((tab) => tab.id);
  const USERS_WINDOW = { width: 1280, height: 860 };

  it("moves into a window of its own, still driven and grouped there, at the size asked for", async () => {
    const { tabs, kinds, detached } = controller();
    const own = userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    const sibling = await tabs.open(A, "https://mail.example.com/", false);

    const answer = await tabs.setWindowSize(A, sized.id, 1000, 700);
    await settle();

    const moved = fake.tabs.get(sized.id)!;
    expect(answer).toEqual({ width: 1000, height: 700 });
    expect(fake.windows.get(moved.windowId)!.content).toEqual(answer);
    expect(moved.windowId).not.toBe(windowId);
    expect(tabsIn(moved.windowId)).toEqual([sized.id]);
    expect(fake.groups.get(moved.groupId)).toMatchObject({
      windowId: moved.windowId,
      title: "Penguin",
      color: "blue",
    });
    expect(tabs.drivable(A, sized.id).tabId).toBe(sized.id);
    expect(kinds(A)).toEqual([`tab:${sized.id}`, `tab:${sibling.id}`]);
    expect(detached).toEqual([]);
    // The user's window and the tabs in it stay as they were.
    expect(fake.windows.get(windowId)).toMatchObject(USERS_WINDOW);
    expect(tabsIn(windowId)).toEqual([own.id, sibling.id]);
    expect(fake.groups.get(fake.tabs.get(sibling.id)!.groupId)?.windowId).toBe(windowId);
    expect(fake.tabs.get(own.id)!.groupId).toBe(-1);
  });

  it("is sized where it is when it already sits alone in such a window", async () => {
    const { tabs } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.setWindowSize(A, sized.id, 1000, 700);
    const own = windowOf(sized.id);
    const windows = [...fake.windows.keys()];

    await expect(tabs.setWindowSize(A, sized.id, 800, 600)).resolves.toEqual({
      width: 800,
      height: 600,
    });
    expect(windowOf(sized.id)).toBe(own);
    expect([...fake.windows.keys()]).toEqual(windows);
    expect(fake.windows.get(windowId)).toMatchObject(USERS_WINDOW);
  });

  it("moves on again when the user opened another tab beside it, leaving that window alone", async () => {
    const { tabs } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.setWindowSize(A, sized.id, 1000, 700);
    const first = windowOf(sized.id);
    const beside = fake.openTab({ windowId: first, url: "https://news.example.com/" });
    const before = { ...fake.windows.get(first)! };

    await expect(tabs.setWindowSize(A, sized.id, 800, 600)).resolves.toEqual({
      width: 800,
      height: 600,
    });
    expect(windowOf(sized.id)).not.toBe(first);
    expect(tabsIn(first)).toEqual([beside.id]);
    expect(fake.windows.get(first)).toMatchObject({ width: before.width, height: before.height });
  });

  it("makes one window for two sizes asked for at once, and ends at the second", async () => {
    const { tabs } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    const answers = await Promise.all([
      tabs.setWindowSize(A, sized.id, 1000, 700),
      tabs.setWindowSize(A, sized.id, 900, 600),
    ]);
    expect(answers).toEqual([
      { width: 1000, height: 700 },
      { width: 900, height: 600 },
    ]);
    expect(fake.windows.size).toBe(2);
  });

  it("answers the size Chrome could give when the screen is smaller than the one asked for", async () => {
    const { tabs } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await expect(tabs.setWindowSize(A, sized.id, 3000, 700)).resolves.toEqual({
      width: fake.screen.width - fake.frame.width,
      height: 700,
    });
  });

  it("answers the size the page kept when Chrome refuses a window far larger than the screen", async () => {
    const { tabs } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await expect(tabs.setWindowSize(A, sized.id, 5000, 700)).resolves.toEqual({
      width: USERS_WINDOW.width - fake.frame.width,
      height: USERS_WINDOW.height - fake.frame.height,
    });
    expect(tabs.drivable(A, sized.id).tabId).toBe(sized.id);
  });

  it("makes a window the user maximized normal again to size it", async () => {
    const { tabs } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.setWindowSize(A, sized.id, 1000, 700);
    const own = fake.windows.get(windowOf(sized.id))!;
    Object.assign(own, {
      state: "maximized",
      ...fake.screen,
      content: {
        width: fake.screen.width - fake.frame.width,
        height: fake.screen.height - fake.frame.height,
      },
    });

    await expect(tabs.setWindowSize(A, sized.id, 900, 600)).resolves.toEqual({
      width: 900,
      height: 600,
    });
    expect(own.state).toBe("normal");
  });

  it("keeps the server's new tabs in the user's window, even with its own window focused", async () => {
    const { tabs } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.setWindowSize(A, sized.id, 1000, 700);
    fake.lastFocusedWindow = windowOf(sized.id);

    const next = await tabs.open(A, "https://news.example.com/", true);
    expect(windowOf(next.id)).toBe(windowId);
  });

  it("opens new tabs beside the sized one only when the user has no window of their own", async () => {
    const { tabs } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.setWindowSize(A, sized.id, 1000, 700);
    fake.closeWindow(windowId);

    const next = await tabs.open(A, "https://news.example.com/", true);
    expect(windowOf(next.id)).toBe(windowOf(sized.id));
  });

  it("still releases the sized tab when the user drags it back out, and forgets the window", async () => {
    const { tabs, kinds } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.setWindowSize(A, sized.id, 1000, 700);
    const own = windowOf(sized.id);
    await settle();

    fake.dragToWindow(sized.id, windowId);
    await settle();
    expect(kinds(A)).toEqual([`tab:${sized.id}`, `tab-released:${sized.id}`]);
    expect(lookup(tabs.snapshot, sized.id)).toBeUndefined();
    expect(fake.windows.has(own)).toBe(false);
    expect(isOwnWindow(tabs.snapshot, own)).toBe(false);
  });

  it("reports the tab closed when the user closes its window, and forgets the window", async () => {
    const { tabs, kinds } = controller();
    userTab();
    const sized = await tabs.open(A, "https://shop.example.com/", true);
    await tabs.setWindowSize(A, sized.id, 1000, 700);
    const own = windowOf(sized.id);

    fake.closeWindow(own);
    await settle();
    expect(kinds(A)).toEqual([`tab:${sized.id}`, `tab-closed:${sized.id}`]);
    expect(isOwnWindow(tabs.snapshot, own)).toBe(false);
  });

  it("refuses a tab the server may not drive, and moves nothing", async () => {
    const { tabs } = controller({ [A]: "a", [B]: "b" });
    const own = userTab();
    const theirs = await tabs.open(A, "https://shop.example.com/", true);
    const released = await tabs.open(A, "https://news.example.com/", true);
    await tabs.release([released.id], "user");

    await expect(tabs.setWindowSize(B, theirs.id, 800, 600)).rejects.toThrow("no_such_tab");
    await expect(tabs.setWindowSize(A, own.id, 800, 600)).rejects.toThrow("no_such_tab");
    await expect(tabs.setWindowSize(A, released.id, 800, 600)).rejects.toThrow("tab_released");
    expect([...fake.windows.keys()]).toEqual([windowId]);
    expect(fake.windows.get(windowId)).toMatchObject(USERS_WINDOW);
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

  it("keeps the windows made for sized tabs that Chrome still has", async () => {
    const { tabs } = controller();
    fake.openTab({ windowId, url: "https://bank.example.com/" });
    const kept = await tabs.open(A, "https://shop.example.com/", true);
    const gone = await tabs.open(A, "https://news.example.com/", true);
    await tabs.setWindowSize(A, kept.id, 1000, 700);
    await tabs.setWindowSize(A, gone.id, 1000, 700);
    const stored = JSON.parse(JSON.stringify(tabs.snapshot));
    const goneWindow = fake.tabs.get(gone.id)!.windowId;
    fake.tabs.delete(gone.id);
    fake.windows.delete(goneWindow);

    const restored = await TabController.restore(parseTabSet(stored));
    const keptWindow = fake.tabs.get(kept.id)!.windowId;
    expect(isOwnWindow(restored, keptWindow)).toBe(true);
    expect(isOwnWindow(restored, goneWindow)).toBe(false);
    expect(isOwnWindow(restored, windowId)).toBe(false);
  });

  it("drops a malformed stored set rather than trusting it", () => {
    const parsed = parseTabSet({
      tabs: {
        "1": { tabId: 1, server: A, windowId: 1, how: "created" },
        "2": { tabId: "2", server: A, windowId: 1, how: "created" },
        "3": { tabId: 3, server: A, windowId: 1, how: "stolen" },
      },
      groups: { [`1 ${A}`]: 7, nonsense: "x" },
      windows: [9, "9", null, 9.5, 9],
    });
    expect(Object.keys(parsed.tabs)).toEqual(["1"]);
    expect(parsed.groups).toEqual({ [`1 ${A}`]: 7 });
    expect(parsed.windows).toEqual([9]);
  });

  it("reads a set stored before tabs could be sized as having no windows of its own", () => {
    const parsed = parseTabSet({
      tabs: { "1": { tabId: 1, server: A, windowId: 1, how: "created", groupId: 7 } },
      groups: { [`1 ${A}`]: 7 },
    });
    expect(lookup(parsed, 1)).toMatchObject({ windowId: 1, groupId: 7 });
    expect(isOwnWindow(parsed, 1)).toBe(false);
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
