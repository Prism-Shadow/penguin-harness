/**
 * A reference staged in the composer, drawn as a chip: what it points at — a Workspace file, a
 * directory, a quoted range of a file, or an excerpt of the conversation — never the text the
 * message will carry. The composer draws one per staged reference, above its text body.
 */
import { S } from "../../lib/strings";
import { excerptLabel } from "../../lib/selection-menu";
import { lineSuffix } from "../../lib/workspace-tree";
import type { ComposerReference } from "../../lib/workspace-tree";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON } from "../../components/ui/group-list";
import { FILE_ICON, QUOTE_ICON } from "../../components/ui/icons";

/**
 * A staged reference, split for display: its name, and the quoted lines as a `:from-to` suffix.
 * The `file:line` form rather than a worded one — it is the shape every editor and stack trace
 * already uses, it needs no translating, and a chip has no room for a sentence.
 *
 * Returned in two pieces because the chip draws them differently: a long name ellipsizes, and the
 * line numbers must not go with it. They are the smaller half and the half the name does not
 * already say. An excerpt has no path and no lines, so its name is the excerpt's own start.
 */
function referenceParts(reference: ComposerReference): { name: string; lines: string } {
  if (reference.kind === "excerpt") return { name: excerptLabel(reference.excerpt), lines: "" };
  const name = reference.path.split("/").pop() ?? reference.path;
  const lines =
    reference.fromLine === undefined || reference.toLine === undefined
      ? ""
      : lineSuffix(reference.fromLine, reference.toLine);
  return { name, lines };
}

/** The whole of what a chip stands for, for its tooltip: path and lines, or the whole excerpt. */
function referenceTitle(reference: ComposerReference): string {
  if (reference.kind === "excerpt") return reference.excerpt;
  return `${reference.path}${referenceParts(reference).lines}`;
}

/**
 * A directory, a file, or a passage carried in — each says what the chip stands for. An excerpt
 * of the conversation is a quotation too, only carried in from the conversation above rather
 * than from a file.
 */
const REFERENCE_ICON: Record<ComposerReference["kind"], string> = {
  dir: FOLDER_ICON,
  file: FILE_ICON,
  quote: QUOTE_ICON,
  excerpt: QUOTE_ICON,
};

export function ReferenceChip({
  reference,
  onRemove,
}: {
  reference: ComposerReference;
  /** The chip's ×: unstages the reference. */
  onRemove: () => void;
}) {
  const { name, lines } = referenceParts(reference);
  const title = referenceTitle(reference);
  return (
    <span
      title={title}
      className="anim-pop flex max-w-48 items-center gap-1 rounded-md bg-gray-100 py-0.5 pl-2 pr-1 font-mono text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200"
    >
      <GlyphIcon
        d={REFERENCE_ICON[reference.kind]}
        size={13}
        className="shrink-0 text-gray-500 dark:text-gray-400"
      />
      {/* The name gives way, the line numbers do not: they are four characters, and they are
          the half the truncated name cannot tell you. The tooltip carries the whole path and
          the range together. */}
      <span className="min-w-0 truncate">{name}</span>
      {lines !== "" && <span className="shrink-0">{lines}</span>}
      <button
        type="button"
        // An excerpt is named by its label here: its tooltip is the whole passage, which is
        // far too long to announce as the name of a remove button.
        aria-label={`${S.files.removeReference} ${reference.kind === "excerpt" ? name : title}`}
        onClick={onRemove}
        className="shrink-0 rounded p-0.5 text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:hover:text-gray-200"
      >
        ×
      </button>
    </span>
  );
}
