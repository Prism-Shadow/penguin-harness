/**
 * Where `penguin chat` reads its keys from: stdin, except on Windows when the CLI runs on a GUI
 * program that was given no console input. Then it is the console's own input, opened by name.
 *
 * The desktop app's `penguin` launchers run the CLI on the app's executable as Node
 * (ELECTRON_RUN_AS_NODE): `bin\penguin.cmd` on PATH, and the `<root>\bin\penguin.cmd` its server
 * writes for terminals and Agents. That executable is a GUI-subsystem program, and Windows gives
 * a GUI program started from cmd or PowerShell no standard handles. Electron attaches it to the
 * console it was started from and reopens stdout and stderr there, but not stdin, which Node then
 * fills with the NUL device. A REPL reading NUL gets end-of-file at once, so the chat showed its
 * prompt and returned to the shell (#1629). `CONIN$` is that console's input, and opened as a
 * terminal it reads like any other: raw mode, keys, Ctrl-C.
 *
 * Nothing else changes. Input on a pipe or from a file is read as given. Node itself is a console
 * program, which has the console's input unless it was redirected. Redirecting the desktop CLI's
 * stdin from NUL looks the same as having no stdin, so the chat reads the console then too.
 */
import fs from "node:fs";
import tty from "node:tty";

export interface TerminalInput {
  /** What the chat reads: `process.stdin`, or the console's input opened for it. */
  stream: NodeJS.ReadStream;
  /** Closes what was opened for the chat; `process.stdin` is left as it is. */
  release(): void;
}

/** Whether stdin is Node's stand-in for no input at all: the NUL device, or no handle. */
function stdinIsAbsent(): boolean {
  try {
    return fs.fstatSync(0).isCharacterDevice();
  } catch {
    return true;
  }
}

/** The input `penguin chat` reads (see the module doc). */
export function terminalInput(): TerminalInput {
  const stdin = process.stdin;
  const asGiven: TerminalInput = { stream: stdin, release: () => {} };
  if (
    process.platform !== "win32" ||
    process.versions.electron === undefined ||
    stdin.isTTY === true ||
    !stdinIsAbsent()
  ) {
    return asGiven;
  }
  let fd: number | null = null;
  try {
    fd = fs.openSync("\\\\.\\CONIN$", "r+");
    const stream = new tty.ReadStream(fd);
    return { stream, release: () => stream.destroy() };
  } catch {
    // No console to read from (started detached, or by a program with no console): stdin as it is.
    if (fd !== null) fs.closeSync(fd);
    return asGiven;
  }
}
