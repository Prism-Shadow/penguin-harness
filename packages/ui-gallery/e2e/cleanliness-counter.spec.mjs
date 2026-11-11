/**
 * The cleanliness counter's rules (scripts/cleanliness.mjs), on a small page of known shapes
 * rather than the app: what a closed box is, which boxes are exempt, what texture behind text is,
 * and how the budget reads a pack's page against the base's. A real engine computes the styles,
 * as it does for the budget guard.
 *
 * - Given an element with four visible sides, an outline or a border image, it is a box that is
 *   not exempt, and its line colour an ink.
 * - Given a rule on one side, a line too faint to see, or a box too small or hidden, there is no
 *   box; given a box below the window, its kind is on the page but not in the window's count.
 * - Given a button, a field, a widget role, the frame of a text field, a `ui-edge` host or a
 *   floating layer, it is a box that is exempt and adds no ink; a tile, or a card holding a field
 *   further down, is not exempt.
 * - Given text on a gradient, it is texture; the same inside the running work step, the texture
 *   home, or a gradient behind no text, is not.
 * - Given a pack's page, a kind of box or texture the base does not have is a breach and the same
 *   kind more often is not; a second line colour is allowed and a third is not; and what a pack
 *   holds absorbs exactly that much.
 */
import { expect, test } from "@playwright/test";
import { BUDGET_VIEWPORT, budgetBreaches, measureCleanliness } from "../scripts/cleanliness.mjs";

const STYLE = `
  body { margin: 0; font: 14px sans-serif; }
  .card { width: 200px; height: 40px; border: 1px solid rgb(200, 0, 0); }
  .card-2 { width: 200px; height: 40px; border: 1px solid rgb(0, 0, 200); }
  .ring { width: 200px; height: 40px; outline: 1px solid rgb(200, 0, 0); }
  .pen { width: 200px; height: 40px; border: 4px solid; border-image: linear-gradient(red, blue) 4; }
  .rule { width: 200px; height: 40px; border-bottom: 1px solid rgb(200, 0, 0); }
  .faint { width: 200px; height: 40px; border: 1px solid rgba(200, 0, 0, 0.05); }
  .tiny { width: 10px; height: 10px; border: 1px solid rgb(200, 0, 0); }
  .edged { border: 1px solid rgb(0, 150, 0); padding: 8px; }
  .paper { width: 200px; height: 40px; background-image: linear-gradient(white, #eee); }
`;

/** Reads a page holding `body`, under the fixture's styles, in the budget's window. */
async function read(page, body) {
  await page.setViewportSize(BUDGET_VIEWPORT);
  await page.setContent(`<style>${STYLE}</style>${body}`);
  return page.evaluate(measureCleanliness);
}

const kinds = (reading) => Object.values(reading.boxKinds).map((entry) => entry.what);

test.describe("what the counter counts", () => {
  test("a card with four sides, an outline or a pen line is a box that is not exempt", async ({
    page,
  }) => {
    const r = await read(
      page,
      `<div class="card">Tools</div><div class="ring">Files</div><div class="pen">Notes</div>`,
    );
    expect(kinds(r)).toEqual(['div "Tools"', 'div "Files"', 'div "Notes"']);
    expect(r.window).toMatchObject({ boxes: 3, nonControl: 3, images: 1 });
    expect(r.lineColours).toEqual(["rgb(200, 0, 0)", "image"]);
  });

  test("a rule, a faint line, a tiny box and a hidden one draw no box", async ({ page }) => {
    const r = await read(
      page,
      `<div class="rule">Row</div>
       <div class="faint">Row</div>
       <div class="tiny"></div>
       <div class="card" style="visibility: hidden">Hidden</div>`,
    );
    expect(kinds(r)).toEqual([]);
    expect(r.window.boxes).toBe(0);
  });

  test("a box below the window is on the page but not in the window's count", async ({ page }) => {
    const r = await read(page, `<div class="card" style="margin-top: 900px">Below the fold</div>`);
    expect(kinds(r)).toEqual(['div "Below the fold"']);
    expect(r.window.nonControl).toBe(0);
  });

  test("a control's edge and a floating layer are boxes that are exempt", async ({ page }) => {
    const r = await read(
      page,
      `<button class="edged">Send</button>
       <input class="edged" value="query" />
       <div class="edged" role="combobox">Model</div>
       <div class="edged"><textarea rows="2">A draft</textarea><button>Attach</button></div>
       <div class="edged ui-edge">Your message</div>
       <div class="edged ui-glass" role="menu">Rename</div>`,
    );
    expect(kinds(r)).toEqual([]);
    expect(r.lineColours).toEqual([]);
    expect(r.window.boxes).toBeGreaterThanOrEqual(6);
  });

  test("a tile, and a card holding a field further down, are not exempt", async ({ page }) => {
    const r = await read(
      page,
      `<div class="edged ui-glass" data-glass="tile">Search plugin</div>
       <div class="edged"><label>Name <input /></label></div>`,
    );
    expect(kinds(r)).toEqual(['div.ui-glass "Search plugin"', 'div "Name"']);
  });

  test("text on a gradient is texture, except in the running work step", async ({ page }) => {
    const r = await read(
      page,
      `<div class="paper">Ruled paper</div>
       <div class="ui-activity" data-state="running"><span class="paper">Running</span></div>
       <div class="paper"></div>`,
    );
    expect(Object.values(r.textureKinds).map((entry) => entry.what)).toEqual(['div "Ruled paper"']);
  });
});

test.describe("how the budget reads a pack's page against the base's", () => {
  const card = { what: 'div.ui-frame "Tools"', n: 2 };
  const base = { boxKinds: { card }, textureKinds: {}, lineColours: ["rgb(1, 1, 1)"] };

  test("a kind of box the base does not draw is a breach, named", () => {
    const pack = {
      ...base,
      boxKinds: { card, row: { what: 'div "Session"', n: 12 } },
    };
    expect(budgetBreaches(pack, base)).toEqual([
      { metric: "nonControl", measured: 1, budget: 0, what: ['div "Session" ×12'] },
    ]);
  });

  test("more of a kind the base draws, as a denser pack fits on screen, is not", () => {
    const pack = { ...base, boxKinds: { card: { ...card, n: 9 } } };
    expect(budgetBreaches(pack, base)).toEqual([]);
  });

  test("text on a texture the base does not have is a breach", () => {
    const pack = { ...base, textureKinds: { paper: { what: 'div "Ruled paper"', n: 1 } } };
    expect(budgetBreaches(pack, base).map((b) => b.metric)).toEqual(["textured"]);
  });

  test("one more line colour than the base is allowed, two more are not", () => {
    const one = { ...base, lineColours: ["rgb(1, 1, 1)", "rgb(2, 2, 2)"] };
    const two = { ...base, lineColours: ["rgb(1, 1, 1)", "rgb(2, 2, 2)", "rgb(3, 3, 3)"] };
    expect(budgetBreaches(one, base)).toEqual([]);
    expect(budgetBreaches(two, base)).toEqual([
      { metric: "inks", measured: 3, budget: 2, what: ["rgb(2, 2, 2)", "rgb(3, 3, 3)"] },
    ]);
  });

  test("a held allowance absorbs exactly what it holds", () => {
    const pack = {
      ...base,
      boxKinds: { card, a: { what: "a", n: 1 }, b: { what: "b", n: 1 } },
    };
    expect(budgetBreaches(pack, base, { nonControl: 2 })).toEqual([]);
    expect(budgetBreaches(pack, base, { nonControl: 1 }).map((b) => b.measured)).toEqual([2]);
  });
});
