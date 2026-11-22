/**
 * Where the CLI's interactive input comes from: stdin, except on Windows when the CLI runs on a
 * GUI program that was given no console input. Then it is the console's own input, opened by
 * name. Every prompt reads through here: `penguin chat`, the tool approval of `penguin run` and
 * `penguin session input`, the `penguin auth login` account and password, the y/N confirmations
 * of `penguin config lang` and `penguin update`, and the script `penguin browser exec` reads from
 * stdin.
 *
 * The desktop app's `penguin` launchers run the CLI on the app's executable as Node
 * (ELECTRON_RUN_AS_NODE): `bin\penguin.cmd` on PATH, and the `<root>\bin\penguin.cmd` its server
 * writes for terminals and Agents. That executable is a GUI-subsystem program, and Windows gives
 * a GUI program started from cmd or PowerShell no standard handles. Electron attaches it to the
 * console it was started from and reopens stdout and stderr there, but not stdin, which Node then
 * fills with the NUL device. A prompt reading NUL gets end-of-file at once: the chat showed its
 * prompt and returned to the shell (#1629), an approval was denied unasked, and a password prompt
 * ended the command. `CONIN$` is that console's input, and opened as a terminal it reads like any
 * other: raw mode (a password is not echoed), keys, Ctrl-C.
 *
 * Nothing else changes. Input on a pipe or from a file is read as given. Node itself is a console
 * program, which has the console's input unless it was redirected. Electron attaches to the
 * console only when it was handed no stdout and no stderr either, so a desktop CLI whose output
 * is captured (an Agent's command, a pipe) has no `CONIN$` to open, and stdin stays as given.
 * Redirecting the desktop CLI's stdin from NUL looks the same as having no stdin, so its prompts
 * read the console then too.
 */
import fs from "node:fs";
import tty from "node:tty";

export interface TerminalInput {
  /** What to read: `process.stdin`, or the console's input opened for this prompt. */
  stream: NodeJS.ReadStream;
  /**
   * Closes what was opened for the prompt, once it has its answer: an open console input keeps
   * the process alive. `process.stdin` is left as it is.
   */
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

/** The input an interactive prompt reads (see the module doc). */
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
    // No console to read from (started detached, or with its output captured): stdin as it is.
    if (fd !== null) fs.closeSync(fd);
    return asGiven;
  }
}
