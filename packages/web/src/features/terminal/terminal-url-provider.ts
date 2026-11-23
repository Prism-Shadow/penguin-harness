import type {
  IBuffer,
  IBufferCell,
  IBufferLine,
  ILink,
  ILinkProvider,
  Terminal,
} from "@xterm/xterm";
import type { LinkClickTracker, LinkPosition } from "./terminal-links";

// Preserve the punctuation rules of xterm's web-links addon, including IPv6 brackets.
const webUrl = /https?:\/\/[^\s"'!*(){}|\\^<>\x60]*[^\s"':,.!?{}|\\^~\[\]\x60()<>]/gi;

interface BufferRow {
  y: number;
  line: IBufferLine;
  text: string;
}

function readRow(buffer: IBuffer, y: number, cols: number): BufferRow | undefined {
  if (y < 1 || y > buffer.length) return;
  const line = buffer.getLine(y - 1);
  if (!line) return;
  const next = y < buffer.length ? buffer.getLine(y) : undefined;
  if (!next?.isWrapped) return { line, y, text: line.translateToString(true, 0, cols) };

  // A double-width glyph that cannot fit in the last column starts the next row.
  // Its unused cell is padding. Other blanks in a continued row still delimit URLs.
  const last = line.getCell(cols - 1);
  const wideWrap = last?.getWidth() === 1 && !last.getChars() && next.getCell(0)?.getWidth() === 2;
  return { line, y, text: line.translateToString(false, 0, wideWrap ? cols - 1 : cols) };
}

// Convert a UTF-16 offset to the first or last terminal column occupied by its glyph.
function positionAt(
  rows: BufferRow[],
  offset: number,
  end: boolean,
  cell: IBufferCell,
): LinkPosition {
  for (const row of rows) {
    if (offset >= row.text.length) {
      offset -= row.text.length;
      continue;
    }
    for (let x = 0; x < row.line.length; x++) {
      row.line.getCell(x, cell);
      const width = cell.getWidth();
      if (width === 0) continue;
      const length = cell.getChars().length || 1;
      if (offset < length) return { x: x + (end ? width : 1), y: row.y };
      offset -= length;
    }
  }
  throw new RangeError("URL offset outside terminal row");
}

// URL parsing can repair a missing host or rewrite an abbreviated numeric address.
// Keep the web-links addon's requirement that the parsed authority appears in the output.
function hasPrintedAuthority(uri: string): boolean {
  try {
    const url = new URL(uri);
    const credentials = url.password ? url.username + ":" + url.password : url.username;
    const authority = (credentials ? credentials + "@" : "") + url.host;
    return uri.toLowerCase().startsWith(url.protocol + "//" + authority.toLowerCase());
  } catch {
    return false;
  }
}

export function terminalUrlProvider(terminal: Terminal, tracker: LinkClickTracker): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const { active } = terminal.buffer;
      const row = readRow(active, y, terminal.cols);
      if (!row) return callback([]);
      const rows: BufferRow[] = [];
      let start = row;
      // A space separates tokens. Read through as many continuations as the URL needs.
      while (start.y > 1 && start.line.isWrapped && !/^\s/.test(start.text)) {
        const previous = readRow(active, start.y - 1, terminal.cols);
        if (!previous) break;
        rows.push(previous);
        start = previous;
        if (/\s/.test(previous.text)) break;
      }
      rows.reverse();
      const startOffset = rows.reduce((length, previous) => length + previous.text.length, 0);
      rows.push(row);
      if (!/\s$/.test(row.text)) {
        for (let nextY = y + 1; nextY <= active.length; nextY++) {
          const next = readRow(active, nextY, terminal.cols);
          if (!next?.line.isWrapped) break;
          rows.push(next);
          if (/\s/.test(next.text)) break;
        }
      }

      const text = rows.map((part) => part.text).join("");
      const links: ILink[] = [];
      const cell = active.getNullCell();
      for (const match of text.matchAll(webUrl)) {
        const uri = match[0];
        const first = match.index;
        const last = first + uri.length - 1;
        if (last < startOffset || first >= startOffset + row.text.length) continue;
        if (!hasPrintedAuthority(uri)) continue;
        const range = {
          start: positionAt(rows, first, false, cell),
          end: positionAt(rows, last, true, cell),
        };
        links.push({
          text: uri,
          range,
          activate: () => {},
          hover: () => tracker.hover(uri, range),
          leave: () => tracker.leave(),
        });
      }
      callback(links);
    },
  };
}
