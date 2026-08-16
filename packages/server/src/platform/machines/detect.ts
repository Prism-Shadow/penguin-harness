/**
 * "What is that machine, and what is on it already?" — asked before anything is sent.
 *
 * This is the one place a remote shell is unavoidable. Everything after it runs under a Node
 * runtime we put there ourselves, but the probe happens *before* that runtime exists, so it
 * has to speak whatever shell the host's sshd hands us: `sh` on Linux and macOS, `cmd.exe` on
 * a default Windows OpenSSH install. Hence two commands rather than one clever one — a POSIX
 * attempt, and a Windows attempt when the first one is clearly not understood.
 *
 * Both print the same two things: an identity line, and the raw text of the installed
 * program's package manifest (empty when nothing is installed). Parsing happens here, not
 * there: the far side only has to `cat` a file, which every shell can do.
 */

/** Separates the identity line from the manifest text in the probe's output. */
const SECTION = "---penguin---";

/**
 * POSIX probe. `uname -s -m` names the machine; the manifest is read from the XDG program
 * directory, the same location the installer writes.
 */
export const POSIX_PROBE = [
  "uname -s -m",
  // The remote's own node, if it has one: a recent enough version means the push can skip
  // sending a runtime entirely. Guarded, because most machines have none.
  "node -v 2>/dev/null || echo none",
  `echo ${SECTION}`,
  `cat "\${XDG_DATA_HOME:-$HOME/.local/share}"/penguin/lib/package.json 2>/dev/null || true`,
].join("; ");

/**
 * Windows (cmd.exe) probe. `&` chains commands there, `%…%` expands variables, `2>nul`
 * discards the error from a missing file — none of which sh would do the same way, which is
 * why this is a separate command rather than a portable one.
 */
export const WINDOWS_PROBE = [
  "echo %OS% %PROCESSOR_ARCHITECTURE%",
  "node -v 2>nul || echo none",
  `echo ${SECTION}`,
  'type "%LOCALAPPDATA%\\penguin\\lib\\package.json" 2>nul',
].join("&");

/** Node's own names, because the runtime download URL is built from them. */
export type RemotePlatform = "linux" | "darwin" | "win32";
export type RemoteArch = "x64" | "arm64";

export interface RemoteIdentity {
  platform: RemotePlatform;
  arch: RemoteArch;
  /** Version of the PenguinHarness installed there, or null when there is none. */
  installedVersion: string | null;
  /** The remote's own `node -v`, or null when it has none — decides whether a runtime is sent. */
  nodeVersion: string | null;
}

/** Maps what `uname -m` / `%PROCESSOR_ARCHITECTURE%` say onto Node's arch names. */
function normalizeArch(raw: string): RemoteArch | null {
  const value = raw.trim().toLowerCase();
  if (["x86_64", "amd64"].includes(value)) return "x64";
  if (["aarch64", "arm64"].includes(value)) return "arm64";
  return null;
}

/** Maps `uname -s` / `%OS%` onto Node's platform names. */
function normalizePlatform(raw: string): RemotePlatform | null {
  const value = raw.trim().toLowerCase();
  if (value === "linux") return "linux";
  if (value === "darwin") return "darwin";
  if (value.includes("windows")) return "win32";
  return null;
}

/** The version out of a package manifest, or null when the text is not one. */
function versionOf(manifestText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(manifestText.trim());
    if (typeof parsed === "object" && parsed !== null) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version !== "") return version;
    }
  } catch {
    /* not a manifest: nothing is installed, or the file is damaged */
  }
  return null;
}

/**
 * Reads either probe's output. Returns null when the identity line is not something we
 * recognize — which is also how "this shell did not understand the command" surfaces, since
 * cmd.exe answers a POSIX probe with an error message rather than a uname line.
 */
export function parseProbeOutput(stdout: string): RemoteIdentity | null {
  const [identityPart, manifestPart = ""] = stdout.split(SECTION);
  const lines = (identityPart ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  // The identity is the FIRST line; the node answer follows it. Anything before them is the
  // shell's own noise (a banner, a warning), which is why the search is anchored on a line
  // that parses as a machine rather than on a position.
  const identity = lines
    .map((line) => {
      const words = line.split(/\s+/);
      if (words.length < 2) return null;
      const platform = normalizePlatform(words[0]!);
      const arch = normalizeArch(words[words.length - 1]!);
      return platform && arch ? { platform, arch, index: lines.indexOf(line) } : null;
    })
    .find((entry) => entry !== null);
  if (!identity) return null;
  const nodeLine = lines[identity.index + 1] ?? "";
  const nodeVersion = /^v\d+\./.test(nodeLine) ? nodeLine : null;
  return {
    platform: identity.platform,
    arch: identity.arch,
    installedVersion: versionOf(manifestPart),
    nodeVersion,
  };
}
