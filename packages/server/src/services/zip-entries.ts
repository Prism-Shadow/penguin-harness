/**
 * What a zip's entries are, beyond the bytes fflate hands back: the names no disk keeps as they
 * are, and the entries recorded as something other than a regular file or a directory. Shared by
 * the archive imports that write an upload's entries to disk as files.
 */
import { strFromU8 } from "fflate";

/**
 * A control character, NUL above all: no disk takes NUL in a name, and a name holding any other
 * one never lists as it is (a newline splits it, an escape sequence redraws the terminal).
 */
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * The entries a zip records as something other than a regular file or a directory — a symbolic
 * link above all. Only the central directory says so: a Unix zipper (host 3) keeps the entry's
 * `st_mode` in the high half of its external attributes. An archive made elsewhere records no type
 * there, and its entries are plain files. The directory is not re-validated here; this runs after
 * fflate has read the same archive without complaint.
 */
export function specialEntries(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end-of-central-directory record: 22 bytes, then a comment of up to 64KB, at the very end.
  let end = -1;
  for (let i = zip.byteLength - 22; i >= Math.max(0, zip.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return [];
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const found: string[] = [];
  for (let n = 0; n < count && at + 46 <= zip.byteLength; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const host = view.getUint8(at + 5);
    const utf8 = (view.getUint16(at + 8, true) & 0x800) !== 0;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const type = (view.getUint32(at + 38, true) >>> 16) & 0o170000;
    if (host === 3 && type !== 0 && type !== 0o100000 && type !== 0o040000) {
      found.push(strFromU8(zip.subarray(at + 46, at + 46 + nameLength), !utf8));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}
