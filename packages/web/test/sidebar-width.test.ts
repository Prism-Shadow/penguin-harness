// @vitest-environment jsdom
/**
 * The pinned sidebar's width as the reader drags its edge (lib/sidebar-width.ts, through the app
 * layout's shell): kept in this browser, so it survives a reload; folded to the rail and back,
 * the sidebar returns at it; and the phone's drawer has no edge to drag. The app window is the
 * real layout on the fake server, without a desktop bridge. jsdom lays nothing out, so the
 * column starts at the window's left edge and the pointer's x is the width a drag asks for.
 *
 * - Given the sidebar's edge dragged, the width is kept, and a reload opens the sidebar at it.
 * - Given a double click on the edge, the kept width is dropped, and a reload opens the sidebar
 *   at the theme's own width.
 * - Given a kept width that does not read as a width, the sidebar opens at the theme's width.
 * - Given the sidebar folded to the rail and unfolded, it is back at the dragged width; the rail
 *   has no edge to drag.
 * - Given the phone's drawer, the sidebar in it has no edge to drag.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { SIDEBAR_WIDTH_KEY } from "../src/lib/sidebar-width";
import { mountAppWindow } from "./helpers/app-window";
import { click, run, unmountAll, waitFor } from "./helpers/dom";

const named = (name: string) => [...document.querySelectorAll(`[aria-label="${name}"]`)];
const edges = () => named(en.nav.resizeSidebar);
const column = () => document.querySelector<HTMLElement>('[data-slot="nav"]')!;
/** The pinned column's drawn width: its inline px, or "theme" while the theme's classes give it. */
const drawn = () => column().style.width || "theme";

/** A pointer event at `x` (jsdom may lack `PointerEvent`). */
function pointer(type: string, x: number): Event {
  const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  return new Ctor(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 300 });
}

/** A drag on the sidebar's edge to `x`, released there. */
async function dragEdgeTo(x: number) {
  const edge = edges()[0]!;
  await run(() => edge.dispatchEvent(pointer("pointerdown", 0)));
  await run(() => window.dispatchEvent(pointer("pointermove", x)));
  await run(() => window.dispatchEvent(pointer("pointerup", x)));
}

/** Opens the app window, or opens it again as a reload does: what is kept in the browser stays. */
async function load() {
  await unmountAll();
  await mountAppWindow();
  await waitFor(() => named(en.nav.collapseSidebar).length > 0);
}

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));
afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

describe("the sidebar's width", () => {
  it("is kept once dragged, and a reload opens the sidebar at it", async () => {
    await load();
    expect(drawn()).toBe("theme");
    await dragEdgeTo(340);
    expect(drawn()).toBe("340px");

    await load();
    expect(drawn()).toBe("340px");
    expect(edges()[0]!.getAttribute("aria-valuenow")).toBe("340");
  });

  it("goes back to the theme's on a double click, and stays there after a reload", async () => {
    await load();
    await dragEdgeTo(340);
    await run(() => edges()[0]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(drawn()).toBe("theme");

    await load();
    expect(drawn()).toBe("theme");
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBeNull();
  });

  it("opens at the theme's when what is kept does not read as a width", async () => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "wide");
    await load();
    expect(drawn()).toBe("theme");
  });

  it("comes back with the sidebar unfolded from the rail, which has no edge of its own", async () => {
    await load();
    await dragEdgeTo(360);
    await click(named(en.nav.collapseSidebar)[0]!);
    expect(edges()).toEqual([]);

    await click(named(en.nav.expandSidebar)[0]!);
    expect(drawn()).toBe("360px");
    expect(edges()).toHaveLength(1);
  });

  it("is not draggable on the phone's drawer", async () => {
    await load();
    // The phone's top bar, at the head of the main column, opens the drawer.
    await click(
      document.querySelector(`[data-slot="main"] button[aria-label="${en.chat.sessionList}"]`)!,
    );
    // The drawer: the layer over the page that holds its scrim and the sidebar's column.
    const drawer = document.querySelector(".ui-scrim")?.parentElement;
    expect(drawer?.querySelector("nav")).toBeTruthy();
    expect(drawer!.querySelector(`[aria-label="${en.nav.resizeSidebar}"]`)).toBeNull();
  });
});
