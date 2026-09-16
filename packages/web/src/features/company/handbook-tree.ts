/**
 * The handbook page's pure model (unit tested): the file listing shaped into the pinned index
 * and an explorer tree of folders and documents, then flattened into the shared file tree's
 * rows (`lib/file-tree.ts`) for an expanded set — the index leading, a collapsed folder
 * contributing one row and no children — plus the folders above a document and how many
 * documents a subtree holds; the path rule the server enforces, mirrored so the new-document
 * dialog refuses a bad path before the request; the body a new document starts with; and how a
 * relative link inside one document resolves to another document of the handbook.
 */
import type { OrgHandbookFile } from "@prismshadow/penguin-server/api";
import type { FileTreeRow } from "../../lib/file-tree";

/** The index, `handbook/README.md`: pinned first in the list, and the one file that cannot be deleted. */
export const HANDBOOK_INDEX = "README.md";

/**
 * The server's rule for a path inside `handbook/`: plain `/`-separated segments, each starting
 * with a letter or digit and made of letters, digits, `.`, `_` and `-` (so no hidden files and
 * no `.` / `..`), at most eight levels deep.
 */
export const HANDBOOK_PATH_PATTERN =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/){0,7}[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isHandbookPath(rel: string): boolean {
  return HANDBOOK_PATH_PATTERN.test(rel);
}

/**
 * What the dialog sends for what was typed: surrounding whitespace, a leading `/` or `./` and
 * a trailing `/` dropped, `.md` appended when the file name carries no extension. Whether the
 * result is a handbook path is the caller's check (isHandbookPath).
 */
export function completeHandbookPath(input: string): string {
  let rel = input
    .trim()
    .replace(/^(?:\.\/|\/)+/, "")
    .replace(/\/+$/, "");
  if (rel !== "" && !fileName(rel).includes(".")) rel += ".md";
  return rel;
}

/** The last segment of a path. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether the page renders the file as Markdown; anything else shows as preformatted text. */
export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

/** The one-line body a new document starts with: a title made of its file name without the extension. */
export function newDocumentBody(path: string): string {
  return `# ${fileName(path).replace(/\.[^.]+$/, "")}\n`;
}

/** One row of the explorer: a folder holding more rows, or a document of the listing. */
export type HandbookNode =
  | { kind: "folder"; name: string; path: string; children: HandbookNode[] }
  | { kind: "file"; name: string; path: string; file: OrgHandbookFile };

export interface HandbookTree {
  /** The index, or null when the listing lacks it (a handbook directory someone emptied by hand). */
  index: OrgHandbookFile | null;
  /** Everything else, nested: folders before files at every level. */
  nodes: HandbookNode[];
}

/**
 * Two names of one level, ordered the way a file explorer orders them: case-insensitively,
 * with case deciding only a tie, so `Brand.md` sits beside `brand.md` rather than above every
 * lowercase name. Locale-independent on purpose — the same listing must order the same way
 * whichever language the app is in.
 */
function byName(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A folder while the tree is being built: its subfolders by name, and the documents directly in it. */
interface Level {
  folders: Map<string, Level>;
  files: OrgHandbookFile[];
}

function levelNodes(level: Level, prefix: string): HandbookNode[] {
  const folders: HandbookNode[] = [...level.folders.entries()]
    .sort(([a], [b]) => byName(a, b))
    .map(([name, child]) => ({
      kind: "folder",
      name,
      path: `${prefix}${name}`,
      children: levelNodes(child, `${prefix}${name}/`),
    }));
  const files: HandbookNode[] = level.files
    .map((file) => ({ kind: "file" as const, name: fileName(file.path), path: file.path, file }))
    .sort((a, b) => byName(a.name, b.name));
  return [...folders, ...files];
}

/**
 * The listing as the explorer draws it: the index apart, everything else nested by its path,
 * folders before files at every level. The listing's own order does not matter.
 */
export function buildHandbookTree(files: readonly OrgHandbookFile[]): HandbookTree {
  const index = files.find((f) => f.path === HANDBOOK_INDEX) ?? null;
  const root: Level = { folders: new Map(), files: [] };
  for (const file of files) {
    if (file.path === HANDBOOK_INDEX) continue;
    const segments = file.path.split("/");
    let level = root;
    for (const name of segments.slice(0, -1)) {
      let child = level.folders.get(name);
      if (child === undefined) {
        child = { folders: new Map(), files: [] };
        level.folders.set(name, child);
      }
      level = child;
    }
    level.files.push(file);
  }
  return { index, nodes: levelNodes(root, "") };
}

/** The folder paths above a document, root first: `a/b/c.md` sits under `a` and then `a/b`. */
export function ancestorFolders(path: string): string[] {
  const segments = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < segments.length; i += 1) out.push(segments.slice(0, i).join("/"));
  return out;
}

/** One rendered row: a shared file-tree row plus what the handbook shows beside a name. */
export interface HandbookRow extends FileTreeRow {
  /** The listing entry a document row stands for; null on a folder row. */
  file: OrgHandbookFile | null;
  /** Documents in a folder's subtree, however deep; 0 on a document row. */
  docs: number;
  /** The pinned index, which belongs to no folder and leads the list. */
  isIndex: boolean;
}

/**
 * The rows the explorer draws, top to bottom: the index first — it is the page every trigger
 * makes the employee read, so it leads the top level rather than sorting into it — then a
 * depth-first walk into every expanded folder. A collapsed folder is one row and its children
 * are none, which is what lets a deep handbook cost nothing to render while it is closed.
 *
 * Nothing here is fetched per folder: the whole listing arrived in one response, so every
 * folder row is loaded.
 */
export function handbookTreeRows(tree: HandbookTree, expanded: ReadonlySet<string>): HandbookRow[] {
  const rows: HandbookRow[] = [];
  // The index shares the top level with the first folders and documents, so it counts in that
  // level's set: a flat run of treeitems has to state its own position and size.
  const topSize = tree.nodes.length + (tree.index === null ? 0 : 1);
  if (tree.index !== null) {
    rows.push({
      path: HANDBOOK_INDEX,
      name: HANDBOOK_INDEX,
      kind: "file",
      depth: 0,
      posInSet: 1,
      setSize: topSize,
      expanded: false,
      loaded: true,
      empty: false,
      file: tree.index,
      docs: 0,
      isIndex: true,
    });
  }
  const walk = (nodes: readonly HandbookNode[], depth: number, offset: number): void => {
    for (const [index, node] of nodes.entries()) {
      const open = node.kind === "folder" && expanded.has(node.path);
      rows.push({
        path: node.path,
        name: node.name,
        kind: node.kind === "folder" ? "dir" : "file",
        depth,
        posInSet: offset + index + 1,
        setSize: depth === 0 ? topSize : nodes.length,
        expanded: open,
        loaded: true,
        empty: node.kind === "folder" && node.children.length === 0,
        file: node.kind === "file" ? node.file : null,
        docs: node.kind === "folder" ? countDocuments(node.children) : 0,
        isIndex: false,
      });
      if (open && node.kind === "folder") walk(node.children, depth + 1, 0);
    }
  };
  walk(tree.nodes, 0, tree.index === null ? 0 : 1);
  return rows;
}

/** How many documents a set of nodes holds, however deep — what a folder row counts. */
export function countDocuments(nodes: readonly HandbookNode[]): number {
  let n = 0;
  for (const node of nodes) n += node.kind === "file" ? 1 : countDocuments(node.children);
  return n;
}

/**
 * Where a relative link inside a document points: another document of the handbook, as its
 * handbook path — or null for anything that is not one (an absolute URL, a bare `#anchor`, a
 * path that climbs out of `handbook/`). Resolved against the linking document's folder the way
 * a browser would, a leading `/` meaning the handbook's root; a `#fragment` or `?query` on the
 * target is dropped.
 */
export function resolveHandbookLink(from: string, href: string): string | null {
  if (href === "" || href.startsWith("#") || href.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let target = href.replace(/[?#].*$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  if (target === "") return null;
  const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
  const out = target.startsWith("/") ? [] : [...base];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const rel = out.join("/");
  return isHandbookPath(rel) ? rel : null;
}
