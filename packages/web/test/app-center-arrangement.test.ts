/**
 * The App Center's arrangement (features/app-center/arrangement.ts): the viewer's stored layout
 * over the shortcuts the server lists, and the moves the grid makes.
 *
 * - The default order puts standard system apps first, then keeps the incoming order.
 * - A stored layout keeps its order and folders; an app it names that is no longer listed drops
 *   out, a listed app it does not name is appended in default grid order, and a folder keeps
 *   its place while it holds an app — one app is enough — and goes once it is empty.
 * - Dropping an app beside another moves it there, inside a folder when the target is in one; a
 *   folder never goes into a folder. Dropping onto an app makes a folder of the two in that
 *   app's place; onto a folder adds to its end. Taking an app out puts it right after its folder,
 *   and taking out the last one leaves no empty folder behind.
 * - Grouping the apps a viewer picked makes one folder of them in the grid's order, at the first
 *   one's place; a picked app leaves the folder it was in, and a folder emptied that way gives
 *   the new folder its place.
 * - Forward and backward step an item within the grid or its folder, and go nowhere at the ends.
 * - Ungrouping puts a folder's apps in its place; the stored layout round-trips the grid.
 * - A drop on a tile's leading or trailing quarter goes beside it, the middle half into it; where
 *   nothing can go into it, the halves decide.
 *
 * Machines' apps (an administrator's App Center lists them after this server's):
 * - A machine's app is keyed by its machine as well: two machines whose Agents share an id and a
 *   workbench are two tiles, and this server's own keys stay what they were.
 * - A stored app is awaited — kept though the grid cannot show it — only while its machine is
 *   listed and has not answered, or while the machines are not known yet; an app of a machine the
 *   list no longer names is not, nor is one of this server's.
 * - Arranging the tiles on screen keeps an awaited app after the item it followed, inside its
 *   folder when that is still there, first when nothing it followed is left; a folder taken apart
 *   leaves its awaited apps at the top level after its own, and does not come back.
 */
import { describe, expect, it } from "vitest";
import type { AppCenterLayout, AppCenterShortcut } from "@prismshadow/penguin-server/api";
import {
  appAwaited,
  appKeyOf,
  arrange,
  canStep,
  keepUnseenApps,
  dissolveFolder,
  duplicateWorkbenchOwners,
  layoutOf,
  makeFolder,
  moveBeside,
  moveIntoFolder,
  moveToEnd,
  newFolderId,
  groupApps,
  renameFolder,
  stepItem,
  takeOutOfFolder,
  type GridItem,
} from "../src/features/app-center/arrangement";
import { dropOnTile } from "../src/features/app-center/tile-drag";

const shortcut = (id: string, agentId = "a1"): AppCenterShortcut => ({
  agentId,
  agentName: "Helper",
  workbenchId: id,
  title: id,
  path: `/app/p/${agentId}/${id}`,
  build: "ready",
});

const LISTED = ["a1/one", "a1/two", "a1/three", "a1/four"];
const shortcuts = () => LISTED.map((key) => shortcut(key.split("/")[1]!));

/** The grid as a readable outline: app keys, and folders as `name[key, key]`. */
const outline = (grid: readonly GridItem[]) =>
  grid.map((item) =>
    item.type === "app" ? item.id : `${item.name}[${item.apps.map((app) => app.id).join(", ")}]`,
  );

const stored = (items: AppCenterLayout["items"]): AppCenterLayout => ({ v: 1, items });

it("matches visible workbench sources across Agents while preserving every installation key", () => {
  const copy = (id: string, agent: string, packageName: string) => ({
    ...shortcut(id, agent),
    packageName,
    title: "Notebook",
  });
  const first = copy("local-a", "reader", "portable-notes");
  const second = copy("local-b", "writer", "portable-notes");
  const other = copy("local-c", "writer", "different-notes");
  const remote = { ...first, machineId: "laptop" };
  const pack = { ...first, plugin: "suite", workbenchId: "agenda" };
  const secondPack = { ...pack, agentId: "writer" };
  const sibling = { ...secondPack, workbenchId: "timer" };
  expect(
    duplicateWorkbenchOwners([first, second, other, remote, pack, secondPack, sibling]),
  ).toEqual(new Set([first, second, remote, pack, secondPack].map(appKeyOf)));
  expect(duplicateWorkbenchOwners([first, { ...first, workbenchId: "another-install" }])).toEqual(
    new Set(),
  );
  const titled = { ...shortcut("old-a", "alpha"), title: "  Shared  " };
  const paired = { ...shortcut("old-b", "beta"), title: "SHARED" };
  expect(duplicateWorkbenchOwners([titled, paired, shortcut("unique", "beta")])).toEqual(
    new Set([appKeyOf(titled), appKeyOf(paired)]),
  );
});

describe("arrange", () => {
  it("keeps the incoming order when there are no standard system apps", () => {
    expect(outline(arrange(shortcuts(), null))).toEqual(LISTED);
  });

  it("places available standard system apps first unless the viewer saved another position", () => {
    const standard = ["benchmark", "usage", "machines", "plugins", "models"].map((id) => ({
      ...shortcut(id, "system_agent"),
      system: { glyph: id },
    }));
    const extra = shortcut("first");
    const apps = [extra, ...standard];
    const expected = ["models", "plugins", "machines", "usage", "benchmark"].map(
      (id) => `system_agent/${id}`,
    );
    expect(outline(arrange(apps, null))).toEqual([...expected, "a1/first"]);
    const layout = stored([
      { type: "folder", id: "f", name: "Work", apps: ["a1/first", "system_agent/usage"] },
    ]);
    expect(outline(arrange(apps, layout))).toEqual([
      "Work[a1/first, system_agent/usage]",
      ...expected.filter((id) => id !== "system_agent/usage"),
    ]);
    expect(outline(arrange([extra, shortcut("models", "system_agent")], null))).toEqual([
      "a1/first",
      "system_agent/models",
    ]);
  });

  it("keeps a stored order and folder, drops what is gone, appends what is new", () => {
    const layout = stored([
      { type: "app", app: "a1/three" },
      { type: "app", app: "a1/gone" },
      { type: "folder", id: "f1", name: "Work", apps: ["a1/one", "a1/four"] },
    ]);
    expect(outline(arrange(shortcuts(), layout))).toEqual([
      "a1/three",
      "Work[a1/one, a1/four]",
      "a1/two",
    ]);
  });

  it("keeps a folder left with one app in its place, and drops an empty one", () => {
    const layout = stored([
      { type: "folder", id: "f1", name: "Work", apps: ["a1/gone", "a1/two"] },
      { type: "folder", id: "f2", name: "Old", apps: ["a1/also-gone"] },
      { type: "app", app: "a1/one" },
    ]);
    expect(outline(arrange(shortcuts(), layout))).toEqual([
      "Work[a1/two]",
      "a1/one",
      "a1/three",
      "a1/four",
    ]);
  });

  it("round-trips through the layout it stores", () => {
    const grid = arrange(
      shortcuts(),
      stored([
        { type: "folder", id: "f1", name: "Work", apps: ["a1/two", "a1/one"] },
        { type: "app", app: "a1/four" },
      ]),
    );
    expect(outline(arrange(shortcuts(), layoutOf(grid)))).toEqual(outline(grid));
  });
});

describe("moves", () => {
  const plain = () => arrange(shortcuts(), null);
  const withFolder = () =>
    arrange(
      shortcuts(),
      stored([
        { type: "app", app: "a1/one" },
        { type: "folder", id: "f1", name: "Work", apps: ["a1/two", "a1/three"] },
        { type: "app", app: "a1/four" },
      ]),
    );

  it("moves an app before or after another", () => {
    expect(outline(moveBeside(plain(), "a1/one", "a1/three", "after"))).toEqual([
      "a1/two",
      "a1/three",
      "a1/one",
      "a1/four",
    ]);
    expect(outline(moveBeside(plain(), "a1/four", "a1/one", "before"))).toEqual([
      "a1/four",
      "a1/one",
      "a1/two",
      "a1/three",
    ]);
  });

  it("moves an app inside a folder when the target is in one, and reorders a folder", () => {
    expect(outline(moveBeside(withFolder(), "a1/four", "a1/two", "after"))).toEqual([
      "a1/one",
      "Work[a1/two, a1/four, a1/three]",
    ]);
    expect(outline(moveBeside(withFolder(), "a1/three", "a1/two", "before"))).toEqual([
      "a1/one",
      "Work[a1/three, a1/two]",
      "a1/four",
    ]);
  });

  it("never puts a folder into a folder: it lands beside the folder of the target", () => {
    const two = makeFolder(withFolder(), "a1/four", "a1/one", { id: "f2", name: "Play" });
    expect(outline(moveBeside(two, "f2", "a1/three", "after"))).toEqual([
      "Work[a1/two, a1/three]",
      "Play[a1/one, a1/four]",
    ]);
  });

  it("makes a folder of two apps in the place of the one dropped on", () => {
    expect(
      outline(makeFolder(plain(), "a1/four", "a1/two", { id: "f9", name: "New folder" })),
    ).toEqual(["a1/one", "New folder[a1/two, a1/four]", "a1/three"]);
  });

  it("adds an app to a folder's end, and leaves a folder dropped on a folder where it was", () => {
    expect(outline(moveIntoFolder(withFolder(), "a1/four", "f1"))).toEqual([
      "a1/one",
      "Work[a1/two, a1/three, a1/four]",
    ]);
    expect(outline(moveIntoFolder(withFolder(), "f1", "f1"))).toEqual(outline(withFolder()));
  });

  it("takes an app out to right after its folder, which keeps its one app; the last one out leaves no folder", () => {
    const one = takeOutOfFolder(withFolder(), "a1/three");
    expect(outline(one)).toEqual(["a1/one", "Work[a1/two]", "a1/three", "a1/four"]);
    expect(outline(takeOutOfFolder(one, "a1/two"))).toEqual(LISTED);
  });

  it("groups the picked apps in the grid's order at the first one's place, out of their folders", () => {
    const made = { id: "f9", name: "Picked" };
    expect(outline(groupApps(withFolder(), ["a1/four", "a1/one"], made))).toEqual([
      "Picked[a1/one, a1/four]",
      "Work[a1/two, a1/three]",
    ]);
    // The first picked app sits in a folder that keeps an app: the new one comes right after it.
    expect(outline(groupApps(withFolder(), ["a1/four", "a1/three"], made))).toEqual([
      "a1/one",
      "Work[a1/two]",
      "Picked[a1/three, a1/four]",
    ]);
    // A folder emptied by the pick gives the new one its place.
    expect(outline(groupApps(withFolder(), ["a1/three", "a1/two"], made))).toEqual([
      "a1/one",
      "Picked[a1/two, a1/three]",
      "a1/four",
    ]);
    // One app is a folder too.
    expect(outline(groupApps(plain(), ["a1/two"], made))).toEqual([
      "a1/one",
      "Picked[a1/two]",
      "a1/three",
      "a1/four",
    ]);
    expect(outline(groupApps(plain(), ["a1/gone"], made))).toEqual(LISTED);
  });

  it("moves an item to the end, out of its folder, which keeps its other app", () => {
    expect(outline(moveToEnd(withFolder(), "a1/two"))).toEqual([
      "a1/one",
      "Work[a1/three]",
      "a1/four",
      "a1/two",
    ]);
  });

  it("steps an item within where it sits, and not past either end", () => {
    expect(outline(stepItem(withFolder(), "f1", -1))).toEqual([
      "Work[a1/two, a1/three]",
      "a1/one",
      "a1/four",
    ]);
    expect(outline(stepItem(withFolder(), "a1/two", 1))).toEqual([
      "a1/one",
      "Work[a1/three, a1/two]",
      "a1/four",
    ]);
    expect(canStep(withFolder(), "a1/one", -1)).toBe(false);
    expect(canStep(withFolder(), "a1/three", 1)).toBe(false);
    expect(outline(stepItem(withFolder(), "a1/one", -1))).toEqual(outline(withFolder()));
  });

  it("renames and ungroups a folder, its apps taking its place", () => {
    expect(outline(renameFolder(withFolder(), "f1", "Desk"))).toEqual([
      "a1/one",
      "Desk[a1/two, a1/three]",
      "a1/four",
    ]);
    expect(outline(dissolveFolder(withFolder(), "f1"))).toEqual(LISTED);
  });

  it("gives a new folder an id no item has, in the layout's id alphabet", () => {
    const grid = withFolder();
    let calls = 0;
    // The first draw repeats an id the grid has; the next is taken.
    const id = newFolderId(
      [...grid, { type: "folder", id: "f00000000", name: "x", apps: [] }],
      () => (calls++ === 0 ? 0 : 0.5),
    );
    expect(id).not.toBe("f00000000");
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});

describe("dropOnTile", () => {
  const rect = { left: 100, width: 80 };

  it("goes before or after on the outer quarters and into the tile in the middle", () => {
    expect(dropOnTile(rect, 110, true)).toEqual({ side: "before" });
    expect(dropOnTile(rect, 140, true)).toBe("into");
    expect(dropOnTile(rect, 175, true)).toEqual({ side: "after" });
  });

  it("splits in halves where nothing can go into the tile", () => {
    expect(dropOnTile(rect, 135, false)).toEqual({ side: "before" });
    expect(dropOnTile(rect, 145, false)).toEqual({ side: "after" });
  });
});

describe("machines' apps", () => {
  const onMachine = (machineId: string, id: string) => ({ ...shortcut(id), machineId });

  it("keys a machine's app by its machine, so the same Agent and workbench on two machines are two tiles", () => {
    const grid = arrange(
      [shortcut("desk"), onMachine("m1", "desk"), onMachine("m2", "desk")],
      null,
    );
    expect(outline(grid)).toEqual(["a1/desk", "m1:a1/desk", "m2:a1/desk"]);
    expect(appKeyOf(shortcut("desk"))).toBe("a1/desk");
  });

  it("awaits an app only while its machine is listed and has not answered, or the machines are not known", () => {
    const machines = [
      { machineId: "m1", answered: false },
      { machineId: "m2", answered: true },
    ];
    expect(appAwaited("m1:a1/desk", machines)).toBe(true);
    // Answered: the app is on the grid, or it is gone from that machine.
    expect(appAwaited("m2:a1/desk", machines)).toBe(false);
    // A machine the list no longer names took its apps with it.
    expect(appAwaited("m3:a1/desk", machines)).toBe(false);
    expect(appAwaited("m3:a1/desk", null)).toBe(true);
    expect(appAwaited("a1/desk", null)).toBe(false);
  });

  const awaited = (key: string) => key.startsWith("m1:");

  it("keeps an awaited app after the tile it followed when the tiles on screen move", () => {
    const previous = stored([
      { type: "app", app: "a1/one" },
      { type: "app", app: "m1:a1/desk" },
      { type: "app", app: "a1/two" },
      { type: "app", app: "a1/three" },
    ]);
    // The grid had no m1 tile: the viewer moved "three" to the front.
    const next = stored([
      { type: "app", app: "a1/three" },
      { type: "app", app: "a1/one" },
      { type: "app", app: "a1/two" },
    ]);
    expect(keepUnseenApps(next, previous, awaited).items).toEqual([
      { type: "app", app: "a1/three" },
      { type: "app", app: "a1/one" },
      { type: "app", app: "m1:a1/desk" },
      { type: "app", app: "a1/two" },
    ]);
  });

  it("keeps an awaited app first when it led, and in its folder after the app it followed there", () => {
    const previous = stored([
      { type: "app", app: "m1:a1/lead" },
      { type: "folder", id: "f1", name: "Work", apps: ["a1/one", "m1:a1/desk", "a1/two"] },
      { type: "app", app: "a1/three" },
    ]);
    const next = stored([
      { type: "app", app: "a1/three" },
      { type: "folder", id: "f1", name: "Work", apps: ["a1/two", "a1/one"] },
    ]);
    expect(keepUnseenApps(next, previous, awaited).items).toEqual([
      { type: "app", app: "m1:a1/lead" },
      { type: "app", app: "a1/three" },
      { type: "folder", id: "f1", name: "Work", apps: ["a1/two", "a1/one", "m1:a1/desk"] },
    ]);
  });

  it("leaves the awaited apps of a folder taken apart at the top level, after its own", () => {
    const previous = stored([
      { type: "folder", id: "f1", name: "Work", apps: ["a1/one", "m1:a1/desk", "a1/two"] },
      { type: "app", app: "a1/three" },
    ]);
    const next = stored([
      { type: "app", app: "a1/one" },
      { type: "app", app: "a1/two" },
      { type: "app", app: "a1/three" },
    ]);
    expect(keepUnseenApps(next, previous, awaited).items).toEqual([
      { type: "app", app: "a1/one" },
      { type: "app", app: "a1/two" },
      { type: "app", app: "m1:a1/desk" },
      { type: "app", app: "a1/three" },
    ]);
  });

  it("stores the grid as it is when nothing was stored before, or nothing is awaited", () => {
    const next = stored([{ type: "app", app: "a1/one" }]);
    expect(keepUnseenApps(next, null, awaited)).toEqual(next);
    const previous = stored([
      { type: "app", app: "m2:a1/gone" },
      { type: "app", app: "a1/one" },
    ]);
    expect(keepUnseenApps(next, previous, awaited)).toEqual(next);
  });
});
