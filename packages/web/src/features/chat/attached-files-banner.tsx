/**
 * Attachment notice for a message's uploaded files: the `[attached file: <path>]` lines the
 * server appends aren't shown verbatim, they collapse into a single line reading
 * "Attached files: a.pdf, b.csv" (paperclip icon + static text, no navigation — the files live
 * in the session scratchpad and the model opens them by path); the body text around them is
 * rendered as usual by the caller. Same shape as SkillsBanner, so the two notices a message
 * can carry read as one family.
 */
import { S } from "../../lib/strings";
import { attachmentFileName } from "../../lib/attachments";
import { GlyphIcon } from "../../components/ui/glyph-icon";

/** Paperclip glyph (24×24 line path), shared with the composer's file-attachment entry. */
export const PAPERCLIP_ICON =
  "M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48";

export function AttachedFilesBanner({ files }: { files: string[] }) {
  return (
    <p className="anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <GlyphIcon d={PAPERCLIP_ICON} className="text-gray-400 dark:text-gray-500" />
      {S.chat.attachedFilesBanner(files.map(attachmentFileName))}
    </p>
  );
}
