/**
 * Markdown tables: every table gets a scroll box of its own, and every cell is told what kind of
 * content it holds, so one stylesheet (markdown-table.css) can keep short cells, figures and code
 * on one line, let long prose wrap, and scroll the box sideways rather than crush the columns.
 *
 * Both Markdown hosts run this pass — `Md` (chat replies, channel bubbles, the Markdown readers)
 * and `SiteMarkdown` (the docs site and the blog) — so a table is shaped the same everywhere, and
 * each host only maps the sheet's custom properties onto its own palette.
 *
 * - **The box.** Each `<table>` is wrapped in `<div class="md-table">`. The table element itself
 *   stays a table (a `display: block` table loses its semantics in some accessibility trees, and
 *   its width stops applying), and the box is what scrolls. The wrapper carries no source
 *   position, so the streaming arrivals pass (stream-arrivals.ts), which runs after this one,
 *   leaves it unmarked and keeps fading the table itself.
 * - **The cell kinds** (`data-cell`):
 *   - `num` — every cell of a column whose body is figures (`1,234`, `-3`, `40%`, `$0.12`,
 *     `12 ms`), header included, unless the author aligned the column: GFM alignment always wins.
 *   - `short` — a cell of at most {@link SHORT_MAX_COLUMNS} display columns with no line break.
 *   - `prose` — anything longer, or with a `<br>`.
 *
 *   A blank cell (empty, a dash, `?`, `n/a`) carries no kind and does not count when a column is
 *   judged, so one missing figure does not turn a column of numbers back into text.
 *
 * It re-parses nothing and only walks the tree, so it is the one rehype stage kept on while a
 * reply streams (markdown-plugins.ts): the box and the kinds are the same before and after the
 * settle render.
 */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** What a cell holds, as `data-cell` carries it. */
export type CellKind = "num" | "short" | "prose";

/**
 * The widest a cell may be, in display columns (a CJK or fullwidth character is two), and still
 * be kept on one line. Wider than this, a cell would force a column wider than a phone screen
 * before it wraps, so it is prose and wraps at the sheet's minimum measure.
 */
export const SHORT_MAX_COLUMNS = 36;

/** What a cell writes when it has no value. Compared lower-case, after trimming. */
const BLANKS = new Set(["", "-", "—", "–", "?", "n/a"]);

/**
 * A figure, with an optional sign, currency, thousands separators, decimals and a short unit:
 * `1,234`, `-3`, `+2.5`, `40%`, `$0.12`, `12 ms`, `95 KB`, `3.5x`, `2024`. Not a version
 * (`v1.2.3`), a date (`2024-01-01`) or a ratio (`1/2`). The space before a unit is any space
 * but a line break.
 */
const NUMERIC = /^[+\-−±]?[$€£¥]?\d[\d,_]*(?:\.\d+)?(?:[^\S\n]?(?:%|[x×]|[A-Za-zµ°]{1,3}))?$/;

/** Whether a node is an element with one of these tag names. */
const element = (node: HastNode, ...tags: string[]): boolean =>
  node.type === "element" && tags.includes(node.tagName ?? "");

/**
 * A cell's text as it reads: every text node under it with its whitespace collapsed, inline code
 * included, and a `<br>` as a line break.
 */
export function cellText(node: HastNode): string {
  if (node.type === "text") return (node.value ?? "").replace(/\s+/g, " ");
  if (element(node, "br")) return "\n";
  return (node.children ?? []).map(cellText).join("");
}

/** A cell with no value: empty, a dash, `?` or `n/a`. */
export function isBlank(text: string): boolean {
  return BLANKS.has(text.trim().toLowerCase());
}

/** A figure, unit and all (see {@link NUMERIC}). */
export function isNumeric(text: string): boolean {
  return NUMERIC.test(text.trim());
}

/**
 * How many columns a text takes on screen, approximately: a CJK or fullwidth character two, any
 * other one.
 */
export function displayColumns(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/** One cell of a table, where it sits and what it reads. */
interface Cell {
  node: HastNode;
  column: number;
  spans: boolean;
  body: boolean;
  text: string;
}

/** The table's own rows, in or out of a row group; a table nested in a cell keeps its own. */
function rowsOf(table: HastNode): HastNode[] {
  return (table.children ?? []).flatMap((child) => {
    if (element(child, "tr")) return [child];
    if (element(child, "thead", "tbody", "tfoot"))
      return (child.children ?? []).filter((row) => element(row, "tr"));
    return [];
  });
}

/** Every cell with its column; a cell spanning columns starts at the first and moves the rest. */
function cellsOf(table: HastNode): Cell[] {
  const cells: Cell[] = [];
  for (const row of rowsOf(table)) {
    let column = 0;
    for (const node of row.children ?? []) {
      if (!element(node, "th", "td")) continue;
      const span = Math.max(1, Number(node.properties?.colSpan ?? 1) || 1);
      const text = cellText(node).trim();
      cells.push({ node, column, spans: span > 1, body: node.tagName === "td", text });
      column += span;
    }
  }
  return cells;
}

/** Whether the author set this cell's alignment (GFM's `:---`, `:---:`, `---:`, or `align`). */
const aligned = (cell: Cell): boolean => {
  const align = cell.node.properties?.align;
  return typeof align === "string" && align !== "";
};

/** The columns whose body is figures and which the author left unaligned. */
function numericColumns(cells: readonly Cell[]): Set<number> {
  const figures = new Set<number>();
  const refused = new Set<number>();
  for (const cell of cells) {
    if (cell.spans) continue;
    if (aligned(cell)) refused.add(cell.column);
    if (!cell.body || isBlank(cell.text)) continue;
    if (!cell.text.includes("\n") && isNumeric(cell.text)) figures.add(cell.column);
    else refused.add(cell.column);
  }
  return new Set([...figures].filter((column) => !refused.has(column)));
}

/** A cell's kind, or none for a blank one. */
function kindOf(cell: Cell, numeric: ReadonlySet<number>): CellKind | undefined {
  if (isBlank(cell.text)) return undefined;
  if (!cell.spans && numeric.has(cell.column)) return "num";
  if (cell.text.includes("\n")) return "prose";
  return displayColumns(cell.text) <= SHORT_MAX_COLUMNS ? "short" : "prose";
}

/** Writes each cell's kind on it as `data-cell`; a blank cell carries none. */
export function classifyTable(table: HastNode): void {
  const cells = cellsOf(table);
  const numeric = numericColumns(cells);
  for (const cell of cells) {
    const { dataCell: _previous, ...properties } = cell.node.properties ?? {};
    const kind = kindOf(cell, numeric);
    cell.node.properties = kind === undefined ? properties : { ...properties, dataCell: kind };
  }
}

/** Whether a node is the box this pass puts around a table. */
function isTableBox(node: HastNode): boolean {
  if (!element(node, "div")) return false;
  const className = node.properties?.className;
  return Array.isArray(className) ? className.includes("md-table") : className === "md-table";
}

function visit(parent: HastNode): void {
  const children = parent.children;
  if (children === undefined) return;
  children.forEach((child, i) => {
    if (element(child, "table")) {
      classifyTable(child);
      if (!isTableBox(parent)) {
        children[i] = {
          type: "element",
          tagName: "div",
          properties: { className: ["md-table"] },
          children: [child],
        };
      }
    }
    visit(child);
  });
}

/** The rehype pass: every table boxed once, every cell classified. */
export function rehypeMarkdownTables() {
  return (tree: HastNode): void => {
    visit(tree);
  };
}
