/**
 * Attachment notice for a message's uploaded files: the `[attached file: <path>]` lines the
 * server appends aren't shown verbatim, they collapse into one harness note (TranscriptNote): the
 * fixed phrase "Attached files" and the names "a.pdf, b.csv" (paperclip icon + static text, no
 * navigation — the files live in the session scratchpad and the model opens them by path); the body text around
 * them is rendered as usual by the caller. It keeps the same visual language as message-level
 * notices; the caller owns its user-side alignment and timestamp footer.
 */
import { ICONS, TranscriptNote } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { attachmentFileName } from "../../lib/attachments";

/** The paperclip: the mark of attached files, shared with the composer's file-attachment entry. */
export const PAPERCLIP_ICON = ICONS.paperclip;

export function AttachedFilesBanner({ files }: { files: string[] }) {
  // The names are cut to the line, the composer chip's rule (truncate max-w-56) applied to a
  // notice that has no fixed width of its own: several long names would otherwise wrap the
  // banner into a paragraph-tall block above the message. The full list stays reachable as
  // its tooltip.
  return (
    <TranscriptNote
      mark={PAPERCLIP_ICON}
      label={S.chat.attachedFilesLabel(files.length)}
      subject={S.chat.nameList(files.map(attachmentFileName))}
      truncate
    />
  );
}
