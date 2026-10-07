/**
 * Windows AppUserModelID (AUMID) registry registration — pure command construction plus
 * an injected runner so every branch unit-tests without Electron or a Windows host.
 *
 * Windows routes toast notifications (`ToastNotificationManager`) and populates the
 * System → Notifications app list by matching the process's `AppUserModelID`
 * (`app.setAppUserModelId`) against either a Start Menu `.lnk` shortcut carrying that
 * property or `HKCU\Software\Classes\AppUserModelId\<AUMID>`. Relying on the shortcut
 * alone fails in three real cases:
 *
 * 1. A dev run (`pnpm desktop` or `--dev`) uses `com.prismshadow.penguinharness.dev`,
 *    which no installer ever creates a Start Menu shortcut for.
 * 2. A user who removed the Start Menu shortcut, or ran an unpackaged/portable build,
 *    has no `.lnk` for Windows to inspect.
 * 3. An all-users NSIS shortcut under `%ProgramData%` without a per-user activator entry
 *    can leave `ToastNotificationManager` unable to resolve the sender identity.
 *
 * Writing `DisplayName` and `IconUri` under `HKCU\Software\Classes\AppUserModelId\<AUMID>`
 * requires no elevation, is idempotent across launches, and satisfies Windows' unpackaged
 * toast sender contract for both the release and dev identities.
 */
import { execFile } from "node:child_process";

/** Registry key Windows inspects for a toast sender's display name and icon. */
export function winAumidRegistryKey(appUserModelId: string): string {
  return `HKCU\\Software\\Classes\\AppUserModelId\\${appUserModelId}`;
}

/**
 * The `reg.exe` argument vectors that register `appUserModelId` for Windows notifications.
 * `IconUri` is written only when the icon asset exists on disk; without it the display name
 * still registers the sender so toasts are not dropped.
 */
export function winAumidRegCommands(opts: {
  appUserModelId: string;
  displayName: string;
  iconPath: string | null;
}): string[][] {
  const key = winAumidRegistryKey(opts.appUserModelId);
  const commands: string[][] = [
    ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", opts.displayName, "/f"],
  ];
  if (opts.iconPath !== null) {
    commands.push(["add", key, "/v", "IconUri", "/t", "REG_SZ", "/d", opts.iconPath, "/f"]);
  }
  return commands;
}

/** Runs one `reg.exe` command without flashing a console window. */
function defaultRunReg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("reg.exe", [...args], { windowsHide: true }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Ensures the current profile's `AppUserModelID` is registered under `HKCU` on Windows.
 * No-op off Windows; best-effort on Windows so a locked-down registry logs one line and
 * never prevents the shell from booting.
 */
export async function registerWindowsAumid(opts: {
  platform: NodeJS.Platform;
  appUserModelId: string;
  displayName: string;
  iconPath: string | null;
  runReg?: (args: readonly string[]) => Promise<void>;
  log: (line: string) => void;
}): Promise<boolean> {
  if (opts.platform !== "win32") return false;
  const run = opts.runReg ?? defaultRunReg;
  const commands = winAumidRegCommands(opts);
  try {
    for (const args of commands) {
      await run(args);
    }
    return true;
  } catch (err) {
    opts.log(
      `Windows AppUserModelID '${opts.appUserModelId}' could not be registered: ${String(err)}`,
    );
    return false;
  }
}
