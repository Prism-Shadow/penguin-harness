/**
 * The desktop app's log: every line the shell prints and everything the embedded server writes,
 * to the console as before and to `<userData>/logs/desktop.log`, each line stamped with the
 * time. A packaged app has no console anyone sees, so the file is how a user can send what
 * happened before a crash, a restart or a hang.
 *
 * The file is capped: when a write would take it past `maxBytes` it is renamed to
 * `desktop.log.1`, replacing the previous one, and a new file begins, so at most twice the cap
 * is kept. Writes are synchronous on purpose: the lines that matter are the last ones before a
 * process dies, and a buffered write would die with them.
 *
 * Logging never takes the app down: the first error (a full disk, a read-only directory) turns
 * the file off, with one line on stderr saying so.
 */
import fs from "node:fs";
import path from "node:path";

/** The size a log file grows to before it is rotated; the previous file doubles what is kept. */
export const DESKTOP_LOG_MAX_BYTES = 5 * 1024 * 1024;
/** A longer line is cut: one runaway line must not rotate away everything before it. */
const MAX_LINE_CHARS = 16 * 1024;

export interface LogFile {
  readonly file: string;
  /** Appends one line, stamped. */
  line(text: string): void;
  /**
   * Appends a chunk of a child process's output: every complete line stamped and prefixed, and
   * an unfinished last line held, per `stream`, until the rest of it arrives.
   */
  output(stream: string, prefix: string, chunk: string): void;
  /** Writes what is still held and closes the file. */
  close(): void;
}

export interface LogFileOptions {
  file: string;
  maxBytes?: number;
  now?: () => Date;
}

function clip(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

export function openLogFile(opts: LogFileOptions): LogFile {
  const maxBytes = opts.maxBytes ?? DESKTOP_LOG_MAX_BYTES;
  const now = opts.now ?? (() => new Date());
  /** Per stream, the start of a line whose end has not arrived yet, and its prefix. */
  const held = new Map<string, { prefix: string; text: string }>();
  let fd: number | null = null;
  let size = 0;
  let off = false;

  const open = (): number => {
    fs.mkdirSync(path.dirname(opts.file), { recursive: true });
    const opened = fs.openSync(opts.file, "a");
    fd = opened;
    size = fs.fstatSync(opened).size;
    return opened;
  };
  const closeFd = () => {
    if (fd === null) return;
    const closing = fd;
    fd = null;
    fs.closeSync(closing);
  };
  const append = (text: string) => {
    if (off || text === "") return;
    try {
      let target = fd ?? open();
      const bytes = Buffer.byteLength(text);
      if (size > 0 && size + bytes > maxBytes) {
        closeFd();
        fs.renameSync(opts.file, `${opts.file}.1`);
        target = open();
      }
      fs.writeSync(target, text);
      size += bytes;
    } catch (err) {
      off = true;
      try {
        closeFd();
      } catch {
        // Already unusable.
      }
      process.stderr.write(`[shell] the log file ${opts.file} is off: ${String(err)}\n`);
    }
  };
  const stamped = (line: string) => `${now().toISOString()} ${clip(line)}\n`;

  return {
    file: opts.file,
    line(text) {
      append(stamped(text));
    },
    output(stream, prefix, chunk) {
      const lines = `${held.get(stream)?.text ?? ""}${chunk}`.split(/\r?\n/);
      let rest = lines.pop() ?? "";
      if (rest.length > MAX_LINE_CHARS) {
        lines.push(rest);
        rest = "";
      }
      held.set(stream, { prefix, text: rest });
      append(lines.map((line) => stamped(`${prefix}${line}`)).join(""));
    },
    close() {
      for (const { prefix, text } of held.values()) {
        if (text !== "") append(stamped(`${prefix}${text}`));
      }
      held.clear();
      try {
        closeFd();
      } catch {
        // Nothing left to lose.
      }
    },
  };
}

// --- the app's one log ---------------------------------------------------------

let sink: LogFile | null = null;

/** Starts writing the log to `file` as well as the console; lines before this reach the console only. */
export function startDesktopLog(file: string): string {
  sink?.close();
  sink = openLogFile({ file });
  return file;
}

/** One line of the shell's own (`[shell] …`, `[updater] …`), to the console and the log file. */
export function logLine(line: string): void {
  process.stdout.write(`${line}\n`);
  sink?.line(line);
}

/** A chunk of the embedded server's output, to the console as it came and to the log file by line. */
export function logServerOutput(stream: "stdout" | "stderr", chunk: string): void {
  process.stdout.write(`[server] ${chunk}`);
  sink?.output(stream, "[server] ", chunk);
}

/** Writes what is held and closes the file; the console keeps working. */
export function stopDesktopLog(): void {
  sink?.close();
  sink = null;
}
