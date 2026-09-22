/**
 * Data paths as folder capsules: a folder (or file) glyph and the last segment, the full path
 * on hover, and a click that copies it exactly as written. path-capsules.ts decides which
 * stretches of text are paths; this module draws them, in Markdown (`PathMarkdown`) and in
 * plain text (`PathText`). The stored text is never rewritten: the capsule is only how it is
 * drawn, and its click copies the path exactly as written.
 *
 * The copy follows the app's one copy affordance (copy-button.tsx): optimistic write, the
 * feedback shown at the control as the glyph swapping to the check and the tooltip flipping to
 * "copied", and a live region beside it for screen readers.
 *
 * In Markdown the pass works on the mdast the shared pipeline produced, so everything the
 * parser already decided holds: a path inside a fenced block or a link stays as it is, and a
 * path the parser split — `__init__` read as emphasis — is left whole as text rather than
 * capsuled in part. A path written with `\` is the exception: the parser took some of its
 * separators for escapes, so its capsule takes the path from the source (spellAsWritten). A
 * capsule reaches React as `<samp>`: no Markdown syntax and no KaTeX output produces one, so
 * claiming it in the components map collides with nothing.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Components, Options } from "react-markdown";
import { S } from "../../lib/strings";
import { ICON_SIZE } from "../../lib/icon-scale";
import { STAT_ICONS } from "../../lib/stat-icons";
import { CopiedStatus, useCopied } from "../../components/ui/copy-button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON } from "../../components/ui/group-list";
import { FILE_ICON } from "../../components/ui/icons";
import { Md } from "../chat/md";
import { codePath, pathKind, pathLabel, spellAsWritten, splitPaths } from "./path-capsules";
import type { PathScope } from "./path-capsules";

/** One data path as a capsule. */
export function PathCapsule({ path }: { path: string }) {
  const { copied, flash } = useCopied();
  const glyph = copied ? STAT_ICONS.check : pathKind(path) === "file" ? FILE_ICON : FOLDER_ICON;
  return (
    <>
      <button
        type="button"
        title={copied ? S.common.copied : S.company.pathCapsule.hint(path)}
        aria-label={S.company.pathCapsule.copy(path)}
        onClick={() => flash(path)}
        // Baseline-aligned on the label, so the capsule sits on the sentence's line; the glyph
        // centres itself instead of dragging the baseline down to its own bottom edge.
        className="inline-flex max-w-full items-baseline gap-1 rounded bg-gray-100 px-1 text-gray-700 transition-colors duration-150 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/40 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <GlyphIcon
          d={glyph}
          size={ICON_SIZE.inlineGlyph}
          className="self-center text-gray-500 dark:text-gray-400"
        />
        <span className="min-w-0 truncate">{pathLabel(path)}</span>
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
        piece.kind === "text" ? piece.text : <PathCapsule key={i} path={piece.path} />,
      )}
    </>
  );
}

/** The mdast shapes this pass touches, declared structurally rather than taking `@types/mdast` on. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  data?: { hName?: string; hChildren?: Array<{ type: string; value: string }> };
}

const CAPSULE_TAG = "samp";

function capsuleNode(path: string): MdNode {
  return {
    type: "pathCapsule",
    data: { hName: CAPSULE_TAG, hChildren: [{ type: "text", value: path }] },
  };
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
        i < children.length - 1 &&
        children[i + 1]!.type !== "break"
      ) {
        pieces[pieces.length - 1] = { kind: "text", text: lastPiece.path };
      }
      const replaced = spellAsWritten(pieces, sourceOf(node, source)).map((p) =>
        p.kind === "path" ? capsuleNode(p.path) : { type: "text", value: p.text },
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
function CapsuleNode({ children }: { children?: ReactNode }) {
  return <PathCapsule path={textOf(children)} />;
}

const PATH_COMPONENTS: Components = { [CAPSULE_TAG]: CapsuleNode };

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
