/**
 * The demo workspace the file boards draw, and the flat row list the app's tree components take
 * from it: every visible entry in order, with its depth, its position in its directory and, for
 * a directory, whether it is open — pure, so the flattening is unit-tested.
 */
import type { FileTreeRow } from "@prismshadow/penguin-ui";

export interface DemoEntry {
  name: string;
  /** A directory's entries; absent for a file. */
  children?: readonly DemoEntry[];
  /** A file's size in bytes, for the row's trailing text. */
  size?: number;
}

export const DEMO_TREE: readonly DemoEntry[] = [
  {
    name: "corpus",
    children: [
      { name: "claude-code-docs", children: [{ name: "hooks.md", size: 8210 }] },
      { name: "index.json", size: 41230 },
    ],
  },
  {
    name: "src",
    children: [
      { name: "rag.ts", size: 3944 },
      { name: "embed.ts", size: 1210 },
      { name: "empty", children: [] },
    ],
  },
  { name: "test", children: [{ name: "rag.test.ts", size: 2711 }] },
  { name: "README.md", size: 612 },
  { name: "package.json", size: 388 },
];

/** The directories open when a board first renders. */
export const DEMO_OPEN_DIRS: readonly string[] = ["src"];

/** The flat rows for the tree, given which directories are open. */
export function flattenTree(
  entries: readonly DemoEntry[],
  openDirs: ReadonlySet<string>,
  parent = "",
  depth = 0,
): FileTreeRow[] {
  return entries.flatMap((entry, index) => {
    const path = parent === "" ? entry.name : `${parent}/${entry.name}`;
    const isDir = entry.children !== undefined;
    const expanded = isDir && openDirs.has(path);
    const row: FileTreeRow = {
      path,
      name: entry.name,
      kind: isDir ? "dir" : "file",
      depth,
      posInSet: index + 1,
      setSize: entries.length,
      expanded,
      loaded: isDir,
      empty: isDir && entry.children!.length === 0,
    };
    return expanded ? [row, ...flattenTree(entry.children!, openDirs, path, depth + 1)] : [row];
  });
}

/** The size a demo file reports, or null for a directory. */
export function demoSize(path: string, entries: readonly DemoEntry[] = DEMO_TREE): number | null {
  const [head, ...rest] = path.split("/");
  const entry = entries.find((candidate) => candidate.name === head);
  if (!entry) return null;
  if (rest.length === 0) return entry.size ?? null;
  return entry.children ? demoSize(rest.join("/"), entry.children) : null;
}
