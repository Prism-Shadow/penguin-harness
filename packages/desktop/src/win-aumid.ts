/**
 * Registers the shell's Windows AppUserModelID (AUMID) as a toast sender under HKCU.
 *
 * Windows attributes a toast to the sending process's AUMID (`app.setAppUserModelId`, see
 * main.ts) and takes the sender's name and icon from a Start Menu shortcut stamped with that
 * AUMID, or from `HKCU\Software\Classes\AppUserModelId\<AUMID>`. The installer's shortcut
 * covers an installed release build; the key also covers the launches that have no such
 * shortcut: the dev profile (`pnpm desktop`, `--dev`), a build run without the installer, a
 * shortcut the user removed. Writing it needs no elevation and repeats harmlessly, so it
 * happens on every launch.
 *
 * main.ts starts it without waiting for it. A reg.exe still running after REG_TIMEOUT_MS is
 * killed, and every failure ends in one log line, never in a rejection. The process boundary
 * (`execFile`) is injectable, so every branch unit-tests without Electron or a Windows host.
 */
import { execFile as nodeExecFile } from "node:child_process";
import path from "node:path";

/** How long one reg.exe write may run before it is killed. */
const REG_TIMEOUT_MS = 5_000;

/** The slice of `child_process.execFile` used here; the callback carries only the outcome. */
export type ExecFile = (
  file: string,
  args: string[],
  options: { windowsHide: boolean; timeout: number },
  callback: (error: Error | null) => void,
) => void;

const runExecFile: ExecFile = (file, args, options, callback) => {
  nodeExecFile(file, args, options, (error) => callback(error));
};

/**
 * The `reg add` argument vectors: the display name always, the icon only when there is one on
 * disk to point at. `/f` overwrites without asking, which every launch after the first needs.
 */
function regAddCommands(opts: {
  appUserModelId: string;
  displayName: string;
  iconPath: string | null;
}): string[][] {
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${opts.appUserModelId}`;
  const commands: string[][] = [
    ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", opts.displayName, "/f"],
  ];
  if (opts.iconPath !== null) {
    commands.push(["add", key, "/v", "IconUri", "/t", "REG_SZ", "/d", opts.iconPath, "/f"]);
  }
  return commands;
}

/**
 * Writes this profile's display name and icon under its AUMID's HKCU key, one reg.exe at a
 * time. A no-op off Windows. Resolves once the writes are done, or once one has failed or been
 * killed, which is logged and ends the attempt; it never rejects, so main.ts can fire it and
 * carry on.
 */
export async function registerWindowsAumid(opts: {
  platform: NodeJS.Platform;
  /** The process environment, for `SystemRoot`. */
  env: NodeJS.ProcessEnv;
  appUserModelId: string;
  displayName: string;
  /** The window icon on disk, or null when there is none. */
  iconPath: string | null;
  log: (line: string) => void;
  /** The process boundary: Node's `execFile` unless a test injects one. */
  execFile?: ExecFile;
}): Promise<void> {
  if (opts.platform !== "win32") return;
  const execFile = opts.execFile ?? runExecFile;
  // The system's own reg.exe, by absolute path: a reg.exe earlier on PATH is never the one
  // run. path.win32, because this is a Windows path whichever platform computes it.
  const regExe = path.win32.join(opts.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
  try {
    for (const args of regAddCommands(opts)) {
      await new Promise<void>((resolve, reject) => {
        execFile(regExe, args, { windowsHide: true, timeout: REG_TIMEOUT_MS }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  } catch (err) {
    // Node's message spans lines (the command, then reg.exe's stderr); the log takes one.
    const reason = (err as { killed?: boolean }).killed
      ? `reg.exe did not exit within ${REG_TIMEOUT_MS} ms and was stopped`
      : String(err).replace(/\s+/g, " ").trim();
    opts.log(`Windows AppUserModelID '${opts.appUserModelId}' could not be registered: ${reason}`);
  }
}
