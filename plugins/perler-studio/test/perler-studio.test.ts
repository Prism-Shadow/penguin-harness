/**
 * Perler Studio: the pattern engine, the print page and the export stash, as a user meets them.
 *
 * - Given solid red and blue areas, when a pattern is built on the basic palette, then they
 *   become that palette's red and blue, one bead per cell.
 * - Given any picture, when a pattern is built, then every bead is counted once: the colour
 *   counts add up to the bead total, beads and empty cells fill the grid, and the legend lists
 *   exactly the colours in use.
 * - Given a colour limit, when a pattern is built, then it uses no more colours than that.
 * - Given stray single beads, when noise merging is on, then they are merged away.
 * - Given a plain border, when the background is removed, then the border becomes empty cells;
 *   when it is kept or replaced by a colour, no cell is empty.
 * - Given a grid and a bead size, then the finished size and the number of boards follow.
 * - Given a palette the user pasted in, when the print page is built, then its codes and names
 *   appear as text, never as markup; the page has one grid row per pattern row.
 * - Given the English interface, the print page is in English: its headings, its tips and the
 *   colour names, with no Chinese left on it.
 * - Given more exports than the handler holds, whether by number or by bytes, then the newest
 *   stays downloadable and the oldest is gone.
 * - The colour maths agrees with the CIEDE2000 reference data (Sharma, Wu and Dalal, 2005).
 */
import { beforeAll, describe, expect, it } from "vitest";
import workbench from "../workbenches/perler-studio/index";

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Colour {
  code: string;
  name: string;
  en: string;
  hex: string;
  count: number;
  char: string;
  order: number;
}
interface Pattern {
  cols: number;
  rows: number;
  cells: Int16Array;
  palette: Colour[];
  used: Colour[];
  total: number;
  empty: number;
  colorCount: number;
  boards29: number;
  widthCm: number;
}
interface Studio {
  color: {
    rgbToLab(r: number, g: number, b: number): number[];
    deltaE2000(a: number[], b: number[]): number;
  };
  palettes: { base(id: string): { colors: Omit<Colour, "count" | "char" | "order">[] } };
  engine: {
    buildFromCells(input: {
      cells: (Rgb | null)[];
      cols: number;
      rows: number;
      settings: Record<string, unknown>;
      palette: Colour[];
      source: null;
    }): Pattern;
  };
  exporters: { buildPrintHtml(pattern: Pattern): string };
  i18n: {
    lang(): "zh" | "en";
    setLang(code: "zh" | "en"): void;
    strings: Record<"zh" | "en", Record<string, unknown>>;
  };
}

let PS: Studio;

beforeAll(async () => {
  // The engine files are the page's classic scripts: each hangs its part on window.PS, and
  // none touches the DOM while loading. The language script comes first, as on the page.
  (globalThis as { window?: unknown }).window = globalThis;
  await import("../workbenches/perler-studio/ui/assets/js/i18n.js");
  await import("../workbenches/perler-studio/ui/assets/js/palettes.js");
  await import("../workbenches/perler-studio/ui/assets/js/color.js");
  await import("../workbenches/perler-studio/ui/assets/js/engine.js");
  await import("../workbenches/perler-studio/ui/assets/js/exporters.js");
  PS = (globalThis as unknown as { PS: Studio }).PS;
});

const rgb = (hex: string): Rgb => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

/** The sampled cells of a picture, `paint(column, row)` giving each one (null: transparent). */
const grid = (cols: number, rows: number, paint: (c: number, r: number) => Rgb | null) =>
  Array.from({ length: cols * rows }, (_, i) => paint(i % cols, Math.floor(i / cols)));

/** Red across, green down, blue falling: a picture that reaches many palette colours. */
const gradient = (cols: number, rows: number) =>
  grid(cols, rows, (c, r) => ({
    r: Math.round((255 * c) / (cols - 1)),
    g: Math.round((255 * r) / (rows - 1)),
    b: Math.round(255 - (200 * c) / (cols - 1)),
  }));

/** A fresh copy of a built-in palette, as the page hands one to each build. */
const paletteOf = (id: string): Colour[] =>
  PS.palettes.base(id).colors.map((c) => ({ ...c, count: 0, char: "", order: 0 }));

function build(
  cells: (Rgb | null)[],
  cols: number,
  rows: number,
  settings: Record<string, unknown> = {},
  palette: Colour[] = paletteOf("hama"),
): Pattern {
  return PS.engine.buildFromCells({
    cells,
    cols,
    rows,
    settings: {
      cols,
      rows,
      colorLimit: 0,
      sample: "area",
      noise: 0,
      bead: 5,
      bg: "keep",
      bgColorHex: "#FFFFFF",
      fit: "cover",
      ...settings,
    },
    palette,
    source: null,
  });
}

/** What the legend, the totals and the grid of one pattern must agree on. */
function expectEveryBeadCountedOnce(p: Pattern) {
  expect(p.used.reduce((sum, c) => sum + c.count, 0)).toBe(p.total);
  expect(p.total + p.empty).toBe(p.cols * p.rows);
  expect(p.colorCount).toBe(p.used.length);
  expect(p.used.every((c) => c.count > 0)).toBe(true);
}

describe("a pattern built from a picture", () => {
  it("turns solid red and blue areas into the palette's red and blue", () => {
    const p = build(
      grid(20, 20, (c) => rgb(c < 10 ? "#E2231A" : "#1B4C9E")),
      20,
      20,
    );
    expect(p.palette[p.cells[10 * 20 + 3]].code).toBe("H05");
    expect(p.palette[p.cells[10 * 20 + 16]].code).toBe("H08");
    expect(p.total).toBe(400);
    expect(p.empty).toBe(0);
  });

  it("counts every bead once, empty cells included", () => {
    // A transparent corner: the cells whose column + row is under 6 are empty.
    const cells = gradient(36, 24).map((cell, i) =>
      (i % 36) + Math.floor(i / 36) < 6 ? null : cell,
    );
    const p = build(cells, 36, 24, { noise: 1 }, paletteOf("universal"));
    expect(p.empty).toBeGreaterThan(0);
    expectEveryBeadCountedOnce(p);
  });

  it("never uses more colours than the limit asks for", () => {
    const unlimited = build(gradient(60, 60), 60, 60, { colorLimit: 96 }, paletteOf("universal"));
    expect(unlimited.colorCount).toBeGreaterThan(12);
    for (const limit of [6, 12]) {
      const p = build(gradient(60, 60), 60, 60, { colorLimit: limit }, paletteOf("universal"));
      expect(p.colorCount).toBeLessThanOrEqual(limit);
      expectEveryBeadCountedOnce(p);
    }
  });

  it("merges stray single beads into what surrounds them", () => {
    // Blue singles scattered over red, no two of them touching.
    const speckled = () =>
      grid(40, 40, (c, r) => rgb((c * 7 + r * 13) % 11 === 0 ? "#1B4C9E" : "#E2231A"));
    const raw = build(speckled(), 40, 40, { noise: 0 });
    const merged = build(speckled(), 40, 40, { noise: 2 });
    expect(merged.colorCount).toBeLessThan(raw.colorCount);
    expectEveryBeadCountedOnce(merged);
  });

  it("clears a plain border when asked to remove the background, and fills every cell otherwise", () => {
    const disc = () =>
      grid(24, 24, (c, r) => rgb((c - 11.5) ** 2 + (r - 11.5) ** 2 < 49 ? "#E2231A" : "#FFFFFF"));
    const removed = build(disc(), 24, 24, { bg: "auto", noise: 1 });
    expect(removed.empty).toBeGreaterThan(100);
    expect(removed.colorCount).toBeLessThanOrEqual(4);

    const kept = build(disc(), 24, 24, { bg: "keep", noise: 1 });
    expect(kept.empty).toBe(0);

    const replaced = build(disc(), 24, 24, { bg: "solid", bgColorHex: "#00B8A9", noise: 1 });
    expect(replaced.empty).toBe(0);
    expect(replaced.colorCount).toBeGreaterThanOrEqual(2);
  });

  it("gives the finished size and the number of 29 x 29 boards from the grid and the bead size", () => {
    const plain = (n: number) => grid(n, n, () => rgb("#FFFFFF"));
    const p52 = build(plain(52), 52, 52, { bead: 5 });
    expect(p52.widthCm).toBe(26);
    expect(p52.boards29).toBe(4);
    const p104 = build(plain(104), 104, 104, { bead: 2.6 });
    expect(p104.widthCm).toBeCloseTo(27.04, 2);
    expect(p104.boards29).toBe(16);
  });
});

describe("the print page", () => {
  it("shows a pasted palette's codes and names as text, never as markup", () => {
    const colour = (code: string, name: string, hex: string): Colour => ({
      code,
      name,
      en: "",
      hex,
      count: 0,
      char: "",
      order: 0,
    });
    const pasted = [
      colour('"><b>x', "<img src=x onerror=alert(1)>", "#E2231A"),
      colour("B&1", "Blue", "#1B4C9E"),
    ];
    const p = build(
      grid(10, 10, (c) => rgb(c < 5 ? "#E2231A" : "#1B4C9E")),
      10,
      10,
      {},
      pasted,
    );
    const html = PS.exporters.buildPrintHtml(p);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('"><b>');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("B&amp;1");
  });

  it("has one grid row per pattern row and a legend entry for every colour used", () => {
    const p = build(gradient(30, 20), 30, 20, { noise: 1 }, paletteOf("universal"));
    const html = PS.exporters.buildPrintHtml(p);
    // Every grid row opens with its row number; so does the column header row.
    const gridRows = (html.match(/<tr><th>/g) ?? []).length - 1;
    expect(gridRows).toBe(p.rows);
    for (const colour of p.used) expect(html).toContain(`>${colour.char}</td>`);
  });

  it("is in English when the interface is", () => {
    const before = PS.i18n.lang();
    PS.i18n.setLang("en");
    try {
      const p = build(
        grid(10, 10, (c) => rgb(c < 5 ? "#E2231A" : "#1B4C9E")),
        10,
        10,
      );
      const html = PS.exporters.buildPrintHtml(p);
      const { en, zh } = PS.i18n.strings;
      expect(html).toContain('<html lang="en">');
      expect(html).toContain(`<h2>${String(en["print.legend"])}</h2>`);
      expect(html).toContain(String(en["print.tip1"]));
      expect(html).not.toContain(String(zh["print.legend"]));
      for (const colour of p.used) expect(html).toContain(`<td class="n">${colour.en}</td>`);
      expect(html).not.toMatch(/[㐀-鿿　-〿＀-￯]/);
    } finally {
      PS.i18n.setLang(before);
    }
  });
});

describe("colour maths", () => {
  it("puts white at L 100 and black at L 0", () => {
    const [whiteL, whiteA] = PS.color.rgbToLab(255, 255, 255);
    expect(Math.abs(whiteL - 100)).toBeLessThan(0.2);
    expect(Math.abs(whiteA)).toBeLessThan(0.05);
    expect(Math.abs(PS.color.rgbToLab(0, 0, 0)[0])).toBeLessThan(0.2);
  });

  it("agrees with the CIEDE2000 reference pair and reads zero for one colour", () => {
    const de = PS.color.deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]);
    expect(Math.abs(de - 2.0425)).toBeLessThan(0.0002);
    expect(PS.color.deltaE2000([50, 10, -10], [50, 10, -10])).toBe(0);
  });
});

type Handle = (req: Record<string, unknown>) => Promise<{
  status?: number;
  body?: unknown;
  bytes?: Uint8Array;
}>;

/** The workbench's handler over a host that keeps its state in memory. */
function openWorkbench(): Handle {
  let state: unknown = null;
  const host = {
    getState: () => state,
    setState: async (next: unknown) => {
      state = next;
    },
    log: () => {},
  };
  const created = workbench.modules.Workbench.create({ use: { host } } as never) as unknown as {
    api: { main: { handle: Handle } };
  };
  return (req) => created.api.main.handle(req);
}

describe("the export stash", () => {
  it.each([
    ["small", 1024],
    ["large", 20 * 1024 * 1024],
  ])("keeps the newest of many %s exports downloadable and lets the oldest go", async (_, size) => {
    const handle = openWorkbench();
    const bytes = new Uint8Array(size); // one buffer handed over each time: the test stays small
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await handle({
        method: "POST",
        path: "/stash",
        query: { name: "pattern.png" },
        headers: { "content-type": "image/png" },
        body: null,
        bytes,
      });
      ids.push((res.body as { id: string }).id);
    }
    const download = (id: string) =>
      handle({ method: "GET", path: `/file/${id}`, query: {}, headers: {}, body: null });

    expect((await download(ids[0])).status).toBe(404);
    const newest = await download(ids[99]);
    expect(newest.status ?? 200).toBe(200);
    expect(newest.bytes?.length).toBe(size);
  });
});
