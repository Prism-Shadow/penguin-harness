/**
 * Tabbed code blocks: a fenced block whose info string carries `tab="Label"` becomes one
 * tab, and adjacent tab blocks group into one switcher. Each tab holds an ordinary code
 * block, so the language keeps driving highlighting and nothing about the code changes.
 *
 *     ```bash tab="Linux / macOS"
 *     curl -fsSL https://penguin.ooo/install.sh | sh
 *     ```
 *
 *     ```powershell tab="Windows"
 *     irm https://penguin.ooo/install.ps1 | iex
 *     ```
 *
 * The group becomes a `div.md-tabs` carrying its labels, in child order, as JSON on
 * `data-tab-labels`. The labels ride on the group rather than on each block because
 * mdast-util-to-hast applies a code node's hProperties to the inner `<code>` and then
 * wraps it in a `<pre>` — a per-block attribute would sit one level below where a reader
 * of the group's children would look for it.
 *
 * Pure mdast in, mdast out — no Vite or DOM — so the transform is unit-testable.
 */

/** The subset of an mdast node this transform reads or writes. */
export interface TabNode {
  type: string;
  meta?: string | null;
  children?: TabNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
  };
}

const TAB_LABEL = /(?:^|\s)tab="([^"]+)"/;

export function remarkTabs() {
  return (tree: TabNode): void => {
    transform(tree);
  };
}

/** The tab label of a fenced block, or undefined when it is an ordinary one. */
export function tabLabelOf(node: TabNode): string | undefined {
  if (node.type !== "code") return undefined;
  return TAB_LABEL.exec(node.meta ?? "")?.[1];
}

function transform(node: TabNode): void {
  if (!node.children) return;

  const out: TabNode[] = [];
  let run: TabNode[] = [];
  let labels: string[] = [];

  const flush = () => {
    if (run.length === 0) return;
    out.push({
      type: "tabGroup",
      children: run,
      data: {
        hName: "div",
        hProperties: { className: "md-tabs", "data-tab-labels": JSON.stringify(labels) },
      },
    });
    run = [];
    labels = [];
  };

  for (const child of node.children) {
    const label = tabLabelOf(child);
    if (label !== undefined) {
      run.push(child);
      labels.push(label);
      continue;
    }
    flush();
    transform(child);
    out.push(child);
  }
  flush();

  node.children = out;
}
