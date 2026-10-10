/**
 * Strikethrough is not rendered: a `~text~` or `~~text~~` shows its tildes as written.
 *
 * GFM reads one or two tildes on each side of a run as strikethrough. Model replies use the
 * tilde for other things far more often than for that — ranges (`3~5 天`, `10~20%`), "about"
 * (`~30 秒`), a casual sign-off — and two such tildes in one paragraph strike out everything
 * between them, which reads as content the model withdrew. The rendered message then says the
 * opposite of what was written.
 *
 * remark-gfm has no switch for strikethrough alone (`singleTilde: false` keeps `~~`), and the
 * rest of GFM — tables, task lists, autolinks, footnotes — stays wanted. So this pass runs on the
 * tree remark-gfm produced and turns every `delete` node back into its own text: the opening
 * tildes, the children as they were parsed (so a `**bold**` inside stays bold), the closing
 * tildes. The markers are read from the source at the node's offset, so `~` stays one tilde and
 * `~~` two.
 *
 * The server's messaging parse does the same for the chat channels
 * (packages/server/src/runtime/messaging/markdown.ts), so a reply reads alike everywhere.
 */
interface Point {
  offset?: number;
}
interface Node {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: Point; end: Point };
}

/** The tilde run (one or two) a strikethrough opened with, read from the source at its offset. */
function markerAt(source: string, offset: number | undefined): string {
  if (offset === undefined) return "~~";
  let run = 0;
  while (run < 2 && source[offset + run] === "~") run++;
  return run === 0 ? "~~" : "~".repeat(run);
}

/** Replaces every `delete` node under `node` with its tildes and its children, in place. */
export function literalStrikethrough(node: Node, source: string): void {
  if (node.children === undefined) return;
  const out: Node[] = [];
  for (const child of node.children) {
    literalStrikethrough(child, source);
    if (child.type !== "delete") {
      out.push(child);
      continue;
    }
    const marker = markerAt(source, child.position?.start.offset);
    out.push({ type: "text", value: marker }, ...(child.children ?? []), {
      type: "text",
      value: marker,
    });
  }
  node.children = out;
}

/** The remark plugin: runs after remark-gfm, against the file's own text. */
export function remarkLiteralTildes() {
  return (tree: Node, file: { value?: unknown }): void => {
    literalStrikethrough(
      tree,
      typeof file.value === "string" ? file.value : String(file.value ?? ""),
    );
  };
}
