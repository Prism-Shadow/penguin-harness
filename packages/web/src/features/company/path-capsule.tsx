/**
 * Data paths as folder capsules: a folder (or file) glyph and the last segment (or the label the
 * writer gave it), the full path on hover, and a click that copies it exactly as written — or,
 * where the surface can preview the organization's files (a channel, an organization's
 * conversation), a click on a file that opens it there. A folder still copies.
 * path-capsules.ts decides which stretches of text are paths; this module draws them, in
 * Markdown (`PathMarkdown`) and in plain text (`PathText`). The stored text is never rewritten:
 * the capsule is only how it is drawn.
 *
 * The copy follows the app's one copy affordance (copy-button.tsx): optimistic write, the
 * feedback shown at the control as the glyph swapping to the check and the tooltip flipping to
 * "copied", and a live region beside it for screen readers.
 *
 * In Markdown the pass works on the mdast the shared pipeline produced, so everything the
 * parser already decided holds: a path inside a fenced block or a link's label stays as it is,
 * and a path the parser split — `__init__` read as emphasis — is left whole as text rather than
 * capsuled in part. A link whose destination is a data path, the `[label](…)` a writer cites a
 * file with, becomes one capsule reading its label. A path written with `\` is the exception to
 * taking the parser's text: it took some of its separators for escapes, so its capsule takes the
 * path from the source (spellAsWritten). A capsule reaches React as `<samp>`: no Markdown syntax
 * and no KaTeX output produces one, so claiming it in the components map collides with nothing.
 */
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { Components, Options } from "react-markdown";
import {
  CopiedStatus,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Md,
  MdExtensionsProvider,
  useCopied,
} from "@prismshadow/penguin-ui";
import type { MdExtensions } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { STAT_ICONS } from "../../lib/stat-icons";
import { codePath, pathKind, pathLabel, spellAsWritten, splitPaths } from "./path-capsules";
import type { PathScope } from "./path-capsules";
import type { CitedFile } from "./cited-file-preview";

/** Opens a cited file's preview. */
export type OpenCitedFile = (file: CitedFile) => void;

const OpenCitedFileContext = createContext<OpenCitedFile | null>(null);

/** Makes every file capsule below open its preview through `open`; null, they copy. */
export function CitedFileOpenerProvider({
  open,
  children,
}: {
  open: OpenCitedFile | null;
  children: ReactNode;
}) {
  return <OpenCitedFileContext.Provider value={open}>{children}</OpenCitedFileContext.Provider>;
}

/** One data path as a capsule, reading `label` when the writer named it. */
export function PathCapsule({ path, label }: { path: string; label?: string }) {
  const { copied, flash } = useCopied();
  const open = useContext(OpenCitedFileContext);
  const file = pathKind(path) === "file";
  const opens = open !== null && file;
  const glyph = copied ? STAT_ICONS.check : file ? ICONS.file : ICONS.folder;
  const hint = opens ? S.company.pathCapsule.openHint(path) : S.company.pathCapsule.hint(path);
  return (
    <>
      <button
        type="button"
        data-tooltip={copied ? S.common.copied : hint}
        data-tooltip-extra
        aria-label={opens ? S.company.pathCapsule.open(path) : S.company.pathCapsule.copy(path)}
        onClick={() =>
          opens ? open({ path, ...(label !== undefined ? { label } : {}) }) : flash(path)
        }
        // Baseline-aligned on the label, so the capsule sits on the sentence's line; the glyph
        // centres itself instead of dragging the baseline down to its own bottom edge.
        className="inline-flex max-w-full items-baseline gap-1 rounded bg-gray-100 px-1 text-gray-700 transition-colors duration-150 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/40 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <GlyphIcon
          d={glyph}
          size={ICON_SIZE.inlineGlyph}
          className="self-center text-gray-500 dark:text-gray-400"
        />
        <span className="min-w-0 truncate">{label ?? pathLabel(path)}</span>
      </button>
      <CopiedStatus copied={copied} />
    </>
  );
}

/** Plain text with its data paths drawn as capsules. */
export function PathText({ text, scope }: { text: string; scope: PathScope }) {
  return (
    <>
      {splitPaths(text, scope).map((piece, i) =>
        piece.kind === "text" ? (
          piece.text
        ) : (
          <PathCapsule key={i} path={piece.path} label={piece.label} />
        ),
      )}
    </>
  );
}

/** The mdast shapes this pass touches, declared structurally rather than taking `@types/mdast` on. */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
    hChildren?: Array<{ type: string; value: string }>;
  };
}

const CAPSULE_TAG = "samp";

/** The capsule's element: the path as its text, the label (when there is one) beside it. */
function capsuleNode(path: string, label?: string): MdNode {
  return {
    type: "pathCapsule",
    data: {
      hName: CAPSULE_TAG,
      ...(label !== undefined ? { hProperties: { dataLabel: label } } : {}),
      hChildren: [{ type: "text", value: path }],
    },
  };
}

/** The text a node holds, its markup dropped: a link's label. */
function plainText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(plainText).join("");
}

/** Parents whose text is not prose to capsule: a link's label (a button cannot nest in an anchor). */
const SKIP = new Set(["link", "linkReference"]);

/** The Markdown a node was parsed from, or its own value when the node carries no position. */
function sourceOf(node: MdNode, source: string): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return start === undefined || end === undefined ? (node.value ?? "") : source.slice(start, end);
}

function walk(parent: MdNode, scope: PathScope, source: string): void {
  const children = parent.children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i]!;
    if (node.type === "inlineCode" && typeof node.value === "string") {
      const path = codePath(node.value, scope);
      if (path !== null) children[i] = capsuleNode(path);
      continue;
    }
    if (node.type === "link" && typeof node.url === "string") {
      const path = codePath(node.url, scope);
      if (path !== null) {
        const label = plainText(node).trim();
        children[i] = capsuleNode(path, label === "" || label === path ? undefined : label);
        continue;
      }
    }
    if (node.type === "text" && typeof node.value === "string") {
      const pieces = splitPaths(node.value, scope);
      if (!pieces.some((p) => p.kind === "path")) continue;
      // A path touching the node's edge may run on into the sibling there — the parser split
      // it (`…/src/__init__.py` has an emphasis in the middle) — so it stays text. Only a bare
      // `/` or `\` can be the tail of such a split; `<app_data_dir>`, `~` and a drive letter
      // only ever start one.
      const first = pieces[0]!;
      const lastPiece = pieces[pieces.length - 1]!;
      if (
        first.kind === "path" &&
        /^[/\\]/.test(first.path) &&
        i > 0 &&
        children[i - 1]!.type !== "break"
      ) {
        pieces[0] = { kind: "text", text: first.path };
      }
      if (
        lastPiece.kind === "path" &&
        node.value.endsWith(lastPiece.path) &&
        i < children.length - 1 &&
        children[i + 1]!.type !== "break"
      ) {
        pieces[pieces.length - 1] = { kind: "text", text: lastPiece.path };
      }
      const replaced = spellAsWritten(pieces, sourceOf(node, source)).map((p) =>
        p.kind === "path" ? capsuleNode(p.path, p.label) : { type: "text", value: p.text },
      );
      children.splice(i, 1, ...replaced);
      i += replaced.length - 1;
      continue;
    }
    if (!SKIP.has(node.type)) walk(node, scope, source);
  }
}

/** The remark pass: data paths in prose and whole-path inline code become capsule nodes. */
export function remarkPathCapsules(scope: PathScope) {
  return (tree: MdNode, file: { value?: unknown }): void =>
    walk(tree, scope, String(file.value ?? ""));
}

function textOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

/** The `<samp>` the pass produced, as the capsule; its text is the path. */
function CapsuleNode({ children, ...props }: { children?: ReactNode; "data-label"?: string }) {
  return <PathCapsule path={textOf(children)} label={props["data-label"]} />;
}

/** The element the pass produces, drawn as the capsule: for a surface that runs the pass itself. */
export const PATH_COMPONENTS: Components = { [CAPSULE_TAG]: CapsuleNode };

/** Markdown with its data paths drawn as capsules. The caller supplies the `md-body` container. */
export function PathMarkdown({ text, scope }: { text: string; scope: PathScope }) {
  const { projectId } = scope;
  // A fresh plugin list is a new processor for react-markdown, so it is rebuilt only when the
  // Project changes.
  const plugins = useMemo<NonNullable<Options["remarkPlugins"]>>(
    () => [[remarkPathCapsules, { projectId }]],
    [projectId],
  );
  return <Md text={text} extraPlugins={plugins} components={PATH_COMPONENTS} />;
}

/**
 * Draws the data paths in every Markdown body below as capsules: an organization's conversations
 * (a desk, a ticket session), whose replies cite the organization's files. `projectId` null draws
 * them as written.
 */
export function PathCapsulesProvider({
  projectId,
  children,
}: {
  projectId: string | null;
  children: ReactNode;
}) {
  const extensions = useMemo<MdExtensions | null>(
    () =>
      projectId === null
        ? null
        : { plugins: [[remarkPathCapsules, { projectId }]], components: PATH_COMPONENTS },
    [projectId],
  );
  return <MdExtensionsProvider extensions={extensions}>{children}</MdExtensionsProvider>;
}
