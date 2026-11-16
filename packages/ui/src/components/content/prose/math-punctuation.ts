/**
 * An inline formula keeps the punctuation mark it touches on its own line.
 *
 * Typeset inline math is an inline-block — prose.css makes `.katex` one for the overflow guard,
 * and KaTeX's own `.base` boxes are inline-blocks inside it — and Chrome takes the edge of an
 * inline-block as a place to break a line whatever character comes next. So
 * `分母 $n-1=2$，不是` can end a line on the formula and start the next with `，`, which no
 * Chinese or Latin typesetting allows. Between two characters the browser's own line-breaking
 * rules already forbid that; only the boundary with the formula escapes them.
 *
 * This pass puts the closing mark right after an inline formula (`，。、；：！？）」』》】` and
 * `,.;:!?)`) and the opening mark right before one (`（「『《【` and `(`) into a single
 * `span.math-nobreak` with the formula, which prose.css sets `white-space: nowrap`. One mark on
 * each side is enough: further into a run like `）。` or `「（` the boundaries are between
 * characters again, which the browser keeps together by itself. Keeping it to one mark is also
 * what makes the overflow guard exact — a formula inside a group may take the column's width less
 * room for two marks (prose.css), so a long formula and its marks still never overflow.
 *
 * Both rehype stages run it. Settled, after `rehype-katex`, the formula is KaTeX's `span.katex`;
 * while a reply streams it is the source span `span.math-inline` the remark stage built, and
 * prose.css lets that source wrap inside itself. The group is the same in both, so settling
 * changes nothing but the formula. Display math is a block of its own and is never grouped, and
 * neither is a formula KaTeX could not parse: its fallback is ordinary inline text.
 */

/** The hast shapes this touches, declared structurally like the sibling passes. */
interface Point {
  line?: number;
  column?: number;
  offset?: number;
}
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  position?: { start: Point; end: Point };
  children?: HastNode[];
}

/** The class prose.css hangs `white-space: nowrap` on. */
const GROUP_CLASS = "math-nobreak";
/** Marks that may not start a line, so they stay with the formula before them. */
const CLOSING = new Set([..."，。、；：！？）」』》】,.;:!?)"]);
/** Marks that may not end a line, so they stay with the formula after them. */
const OPENING = new Set([..."（「『《【("]);

function classesOf(node: HastNode): unknown[] {
  const className = node.properties?.className;
  return Array.isArray(className) ? className : [];
}

/** An inline formula: KaTeX's inline output, or the source span a streaming render holds. */
function isInlineFormula(node: HastNode): boolean {
  if (node.type !== "element" || node.tagName !== "span") return false;
  const classes = classesOf(node);
  return classes.includes("katex") || classes.includes("math-inline");
}

/** An element whose inside holds no formula to group: math of any kind, typeset or not, and code. */
function isOpaque(node: HastNode): boolean {
  if (node.tagName === "pre" || node.tagName === "code") return true;
  const classes = classesOf(node);
  return ["katex", "katex-display", "katex-error", "math"].some((name) => classes.includes(name));
}

/** Where `text` ends when it starts at `point`. */
function advance(point: Point, text: string): Point {
  const lines = text.split("\n");
  const last = lines[lines.length - 1]!;
  return {
    line: (point.line ?? 1) + lines.length - 1,
    column: lines.length > 1 ? last.length + 1 : (point.column ?? 1) + last.length,
    offset: (point.offset ?? 0) + text.length,
  };
}

/**
 * A text node cut in two at `at`, either half dropped when empty. Positions follow the cut when
 * the text is its source verbatim (as long as its span in the source), which is what lets the
 * streaming arrivals pass (stream-arrivals.ts) still split each half at the right character; a
 * text shortened by an escape or an entity has no exact cut point, so its halves carry none.
 */
function cut(node: HastNode, at: number): [HastNode | null, HastNode | null] {
  const value = node.value ?? "";
  const head = value.slice(0, at);
  const tail = value.slice(at);
  const position = node.position;
  const start = position?.start.offset;
  const end = position?.end.offset;
  const exact =
    position !== undefined &&
    start !== undefined &&
    end !== undefined &&
    end - start === value.length;
  const middle = exact ? advance(position.start, head) : undefined;
  const piece = (text: string, from?: Point, to?: Point): HastNode | null => {
    if (text === "") return null;
    return from && to
      ? { type: "text", value: text, position: { start: from, end: to } }
      : { type: "text", value: text };
  };
  return [piece(head, position?.start, middle), piece(tail, middle, position?.end)];
}

/** Groups every inline formula under `parent` with the marks it touches, recursively. */
function group(parent: HastNode): void {
  const children = parent.children;
  if (children === undefined) return;
  const out: HastNode[] = [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (!isInlineFormula(child)) {
      if (child.type === "element" && !isOpaque(child)) group(child);
      out.push(child);
      continue;
    }
    const members: HastNode[] = [child];
    const before = out[out.length - 1];
    if (before?.type === "text" && OPENING.has((before.value ?? "").slice(-1))) {
      const [rest, mark] = cut(before, (before.value ?? "").length - 1);
      out.pop();
      if (rest) out.push(rest);
      members.unshift(mark!);
    }
    const after = children[index + 1];
    if (after?.type === "text" && CLOSING.has((after.value ?? "").charAt(0))) {
      const [mark, rest] = cut(after, 1);
      members.push(mark!);
      // The rest is read as the next child, so a formula right after it sees it as `before`.
      if (rest) children[index + 1] = rest;
      else index++;
    }
    out.push(
      members.length === 1
        ? child
        : {
            type: "element",
            tagName: "span",
            properties: { className: [GROUP_CLASS] },
            children: members,
          },
    );
  }
  parent.children = out;
}

/** rehype plugin, for both stages: see the module comment. */
export function rehypeMathPunctuation() {
  return (tree: HastNode): void => group(tree);
}
