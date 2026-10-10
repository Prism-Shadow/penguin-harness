/**
 * A paste too long to live in the composer's text box becomes a text-file attachment instead.
 *
 * A pasted log of hundreds of kilobytes makes every later keystroke re-render and re-measure
 * the whole text, and the tab stops responding. Kept as a file, it travels the same way any
 * attached file does — staged as a chip, written to the Session's scratchpad on send, and
 * named in the message by its `[attached file: …]` line — so the model still reads all of it,
 * and the text box keeps only what the user types.
 */

/** Past either limit a paste is attached as a file rather than inserted. */
export const LONG_PASTE_MAX_CHARS = 20_000;
export const LONG_PASTE_MAX_LINES = 400;

/** Whether `text` is too long to insert into the text box. */
export function isLongPaste(text: string): boolean {
  if (text.length > LONG_PASTE_MAX_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines > LONG_PASTE_MAX_LINES) return true;
  }
  return false;
}

/** The attachment's file name: `pasted-YYYYMMDD-HHmmss.txt`, in the viewer's local time. */
export function longPasteFileName(at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  const time = `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `pasted-${date}-${time}.txt`;
}
