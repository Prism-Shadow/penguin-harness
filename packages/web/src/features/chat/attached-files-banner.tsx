/**
 * Attachment notice for a message's uploaded files: the `[attached file: <path>]` lines the
 * server appends aren't shown verbatim, they collapse into a single line reading
 * "Attached files: a.pdf, b.csv" (paperclip icon + static text, no navigation — the files live
 * in the session scratchpad and the model opens them by path); the body text around them is
 * rendered as usual by the caller. It keeps the same visual language as message-level notices;
 * the caller owns its user-side alignment and timestamp footer.
 */
import { GlyphIcon, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { attachmentFileName } from "../../lib/attachments";

/** The paperclip: the mark of attached files, shared with the composer's file-attachment entry. */
export const PAPERCLIP_ICON = ICONS.paperclip;

export function AttachedFilesBanner({ files }: { files: string[] }) {
  const label = S.chat.attachedFilesBanner(files.map(attachmentFileName));
  return (
    // max-w-full + truncate, the composer chip's rule (truncate max-w-56) applied to a notice
    // that has no fixed width of its own: several long names would otherwise wrap the banner
    // into a paragraph-tall block above the message. The full list stays reachable as a title.
    <p
      data-tooltip={label}
      className="flex w-fit max-w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
    >
      <GlyphIcon d={PAPERCLIP_ICON} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <span className="min-w-0 truncate">{label}</span>
    </p>
  );
}
