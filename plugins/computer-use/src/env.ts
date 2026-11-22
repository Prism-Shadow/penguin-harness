/**
 * The environment agent-desktop runs with: named variables of the server's own, never the whole
 * of it.
 *
 * agent-desktop has to see the desktop session the server runs in — on Linux the display, the
 * session bus and the runtime directory (a server started without them sees no apps), on Windows
 * the profile and temp directories, everywhere HOME and PATH (`launch` looks programs up on it).
 * The names are the system's own, non-secret variables, the ones an app agent-desktop launches
 * expects to find (it inherits this environment): locale and XDG directories on Linux and macOS,
 * the profile, program and processor variables on Windows. Nothing else of the server's
 * environment reaches it: not its API keys, not `PENGUIN_*`, no credential socket such as
 * `SSH_AUTH_SOCK`, and not agent-desktop's own `AGENT_DESKTOP_SESSION` / `AGENT_DESKTOP_AGENT_ID`
 * / `RUST_LOG`, which would change which refs a command sees. What this plugin sets is added on
 * top: the state directory, and on macOS the helper's path. agent-desktop passes its environment
 * on to what it launches, `AGENT_DESKTOP_HOME` included, with no way to hold it back — so a
 * `launch` runs with a state directory of its own that holds no Session's refs (cli.ts).
 */

/** Read from the server's environment on every platform. */
const COMMON = ["PATH", "HOME", "USER", "LOGNAME", "TZ"];

/** The locale an app formats and translates by (Linux and macOS). */
const LOCALE = [
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_NUMERIC",
  "LC_TIME",
  "LC_COLLATE",
  "LC_MONETARY",
  "LC_PAPER",
  "LC_NAME",
  "LC_ADDRESS",
  "LC_TELEPHONE",
  "LC_MEASUREMENT",
  "LC_IDENTIFICATION",
  "SHELL",
];

/** The desktop session on Linux (X11, Wayland, the session bus). */
const LINUX = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "XDG_SESSION_DESKTOP",
  "XDG_DATA_HOME",
  "XDG_DATA_DIRS",
  "XDG_CONFIG_HOME",
  "XDG_CONFIG_DIRS",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_SESSION_CLASS",
  "XDG_SESSION_ID",
  "XDG_SEAT",
  "XDG_VTNR",
  "DESKTOP_SESSION",
  "GDMSESSION",
  "XAUTHORITY",
  "XCURSOR_THEME",
  "XCURSOR_SIZE",
  "QT_QPA_PLATFORMTHEME",
  "TMPDIR",
];

const MACOS = ["TMPDIR", "__CF_USER_TEXT_ENCODING", "XPC_FLAGS"];

/** Windows: the profile, the temp directories and the system paths a Windows program expects. */
const WINDOWS = [
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "APPDATA",
  "TEMP",
  "TMP",
  "SystemRoot",
  "windir",
  "SystemDrive",
  "ALLUSERSPROFILE",
  "PUBLIC",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
  "PATHEXT",
  "PSModulePath",
  "ComSpec",
  "OS",
  "COMPUTERNAME",
  "USERNAME",
  "USERDOMAIN",
  "USERDOMAIN_ROAMINGPROFILE",
  "SESSIONNAME",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "DriverData",
];

/** The names this platform passes through. */
export function passedNames(platform: NodeJS.Platform): string[] {
  if (platform === "win32") return [...COMMON, ...WINDOWS];
  if (platform === "darwin") return [...COMMON, ...LOCALE, ...MACOS];
  return [...COMMON, ...LOCALE, ...LINUX];
}

/**
 * The environment for one run: the passed names that `base` sets (looked up without regard to
 * case on Windows, where `Path` and `PATH` are one variable), then `extra`.
 */
export function agentDesktopEnv(
  base: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  const keys = Object.keys(base);
  for (const name of passedNames(platform)) {
    const key =
      platform === "win32" ? keys.find((k) => k.toLowerCase() === name.toLowerCase()) : name;
    const value = key === undefined ? undefined : base[key];
    if (value !== undefined && value !== "") env[name] = value;
  }
  return { ...env, ...extra };
}
