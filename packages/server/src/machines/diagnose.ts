/**
 * "Could this server install on that machine and reach it — and if not, what is in the way?"
 * Asked over ssh without writing anything there, so a person can find out before an install
 * fails halfway, and can tell a fault of their own setup from one of the machine's.
 *
 * Six checks, each answered with facts the page words in its own language:
 *
 * - ssh: a session comes up in BatchMode, the way every job here connects;
 * - platform: an OS and architecture a release is published for;
 * - tools: what the release installer runs on the far side (curl, tar, gzip, a sha256 tool);
 * - download: whether the machine itself reaches the release for its platform — on GitHub or
 *   the OSS mirror, the two sources install.sh downloads from — for the version this server
 *   would install;
 * - disk: free space in the home the program and its data root go to;
 * - port: whether the port this server starts the machine's server on is free, or already
 *   that server's own.
 *
 * The POSIX checks run as ONE command over the session (the probe before it opened it), so a
 * check costs one round trip whatever the count. A Windows machine answers the probe and
 * nothing else: it can be installed on but not connected (transport/connection.ts).
 */
import type { MachineCheck, MachineSourceReach } from "../api/types.js";
import type { RemoteIdentity } from "./detect.js";
import type { RemoteLayout } from "./layout.js";
import { explainSshFailure } from "./ssh-failure.js";

/**
 * Where install.sh downloads a release from — its OSS_RELEASE_ROOT and GITHUB_RELEASE_ROOT,
 * repeated here because an installer is a standalone file this module cannot import.
 * machines-diagnose.test.ts reads install.sh and fails when the two drift.
 */
export const RELEASE_SOURCES = {
  oss: "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases",
  github: "https://github.com/Prism-Shadow/penguin-harness/releases/download",
} as const;

/**
 * Free space an install needs in the machine's home: the release download (~95 MB) and the
 * program it unpacks to (~330 MB), staged beside the previous one while it swaps, plus the
 * replicated build (~30 MB) and the archives it unpacks at boot — rounded up.
 */
export const INSTALL_NEEDS_MB = 800;

/** Below this much free space an install fits, but not twice: worth saying, not a refusal. */
const ROOM_MB = 2 * INSTALL_NEEDS_MB;

/**
 * The oldest glibc the release's bundled Node runs on: nodejs.org's Linux builds of Node 24
 * are linked against glibc 2.28 (CentOS 7's 2.17 is too old; a musl system has none).
 */
export const MIN_GLIBC = "2.28";

/** The tools install.sh runs besides the shell's own; one sha256 tool of the two it accepts. */
const TOOLS = ["curl", "tar", "gzip", "mktemp"];

/** A release version as this module puts it in a URL: semver, no `v`. */
function checkedVersion(version: string): string {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) throw new Error(`bad version ${version}`);
  return version;
}

/**
 * Whether the machine itself reaches release `version` for its own platform, on each of the
 * two sources: `@@oss <http code> <curl exit>` and `@@github …`, or `@@nocurl`. A one-byte GET
 * of the package's checksum rather than a HEAD: GitHub redirects a release asset to a signed
 * URL that answers only the method it was signed for.
 */
export function releaseReachCommand(version: string): string {
  const v = checkedVersion(version);
  const curl = (url: string) =>
    `curl -sL -r 0-0 -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "${url}"`;
  return [
    `case "$(uname -s)" in Linux) o=linux;; Darwin) o=darwin;; *) o=;; esac`,
    `case "$(uname -m)" in x86_64|amd64) a=x64;; aarch64|arm64) a=arm64;; *) a=;; esac`,
    `if ! command -v curl >/dev/null 2>&1; then echo "@@nocurl"; ` +
      `elif [ -n "$o" ] && [ -n "$a" ]; then ` +
      `f="penguin-$o-$a.tar.gz.sha256"; ` +
      `c=$(${curl(`${RELEASE_SOURCES.oss}/v${v}/$f`)}); echo "@@oss $c $?"; ` +
      `c=$(${curl(`${RELEASE_SOURCES.github}/v${v}/$f`)}); echo "@@github $c $?"; fi`,
  ].join("; ");
}

/**
 * The machine's reach to the two sources from releaseReachCommand's output; both
 * `unreachable` when it has no curl to ask with (the installer needs curl to download, too).
 */
export function parseReleaseReach(output: string): {
  oss: MachineSourceReach;
  github: MachineSourceReach;
} {
  const facts = tagged(output);
  if (facts.has("nocurl")) return { oss: "unreachable", github: "unreachable" };
  return { oss: reach(facts.get("oss")?.[0]), github: reach(facts.get("github")?.[0]) };
}

/**
 * The POSIX command: one tagged line per fact. `version` is the release the image stands on
 * (no `v`); `port` the port the machine's server would be started on.
 */
export function diagnoseCommand(
  layout: RemoteLayout,
  version: string | null,
  port: number,
): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${port}`);
  const lock = `${layout.dataRoot.posix}/server.lock`;
  return [
    `echo "@@who $(id -un 2>/dev/null) $(hostname 2>/dev/null)"`,
    `for t in ${TOOLS.join(" ")}; do command -v "$t" >/dev/null 2>&1 || echo "@@missing $t"; done`,
    `command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || echo "@@missing sha256sum"`,
    `echo "@@disk $(df -Pk "$HOME" 2>/dev/null | awk 'NR==2 {print $4}')"`,
    `if [ "$(uname -s)" = Linux ]; then echo "@@libc $( (ldd --version 2>&1 || true) | head -n 1)"; fi`,
    ...(version === null ? [] : [releaseReachCommand(version)]),
    `p=$(sed -n 's/.*"pid":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "${lock}" 2>/dev/null)`,
    `q=$(sed -n 's/.*"port":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "${lock}" 2>/dev/null)`,
    `if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo "@@lock $q"; fi`,
    `if command -v curl >/dev/null 2>&1; then c=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 4 "http://127.0.0.1:${port}/"); echo "@@port $c $?"; fi`,
  ].join("; ");
}

/** The tagged lines of the command's output, by tag; the rest is the shell's own noise. */
function tagged(output: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const raw of output.split("\n")) {
    const match = /^@@(\w+)\s?(.*)$/.exec(raw.trim());
    if (match === null) continue;
    out.set(match[1]!, [...(out.get(match[1]!) ?? []), match[2]!.trim()]);
  }
  return out;
}

/**
 * What curl said about one source: 200 or 206 is there; 404 is reachable and not there (that
 * version or target is not published); anything else — curl could not connect, a proxy
 * refused, a timeout — is out of reach.
 */
function reach(line: string | undefined): MachineSourceReach {
  const [code] = (line ?? "").split(/\s+/);
  if (code === "200" || code === "206") return "ok";
  if (code === "404") return "missing";
  return "unreachable";
}

/**
 * The checks a session that could not open answers: why, and nothing else — every other check
 * needs the session.
 */
export function sshFailureChecks(said: string, alias: string): MachineCheck[] {
  return [
    {
      id: "ssh",
      state: "fail",
      reason: explainSshFailure(said, alias)?.reason ?? "other",
      said: said.trim().slice(0, 600),
    },
    ...(["platform", "tools", "download", "disk", "port"] as const).map((id): MachineCheck => ({
      id,
      state: "skip",
    })),
  ];
}

/** Whether `version` (`a.b`) is older than `floor`. */
function older(version: string, floor: string): boolean {
  const [a = 0, b = 0] = version.split(".").map(Number);
  const [x = 0, y = 0] = floor.split(".").map(Number);
  return a < x || (a === x && b < y);
}

/**
 * The platform as the release's Node sees it: a POSIX system and architecture a release is
 * published for, on Linux with a glibc new enough — `ldd --version`'s first line names it, and
 * a musl system says musl there.
 */
function platformCheck(identity: RemoteIdentity, libc: string | undefined): MachineCheck {
  const { platform: os, arch } = identity;
  if (os === "linux" && libc !== undefined) {
    if (/musl/i.test(libc)) return { id: "platform", state: "fail", reason: "musl", os, arch };
    const glibc = /(\d+\.\d+)\S*\s*$/.exec(libc)?.[1];
    if (glibc !== undefined && older(glibc, MIN_GLIBC)) {
      return { id: "platform", state: "fail", reason: "glibc", os, arch, glibc, need: MIN_GLIBC };
    }
  }
  return { id: "platform", state: "pass", os, arch };
}

/**
 * The checks once the probe has said what the machine is: everything from the command's
 * output on POSIX, and only what the probe said for Windows.
 */
export function parseDiagnosis(
  identity: RemoteIdentity,
  output: string,
  opts: { version: string | null; port: number },
): MachineCheck[] {
  const facts = tagged(output);
  const first = (tag: string) => facts.get(tag)?.[0];
  const [user = "", host = ""] = (first("who") ?? "").split(/\s+/);
  const checks: MachineCheck[] = [{ id: "ssh", state: "pass", user, host }];
  if (identity.platform === "win32") {
    checks.push({ id: "platform", state: "warn", os: "win32", arch: identity.arch });
    for (const id of ["tools", "download", "disk", "port"] as const) {
      checks.push({ id, state: "skip" });
    }
    return checks;
  }
  checks.push(platformCheck(identity, first("libc")));

  // curl only downloads the release, and a machine without it is sent the release over ssh
  // (install-server.ts): a caveat. The rest the installer cannot do without.
  const missing = facts.get("missing") ?? [];
  checks.push({
    id: "tools",
    state: missing.some((tool) => tool !== "curl") ? "fail" : missing.length > 0 ? "warn" : "pass",
    missing,
  });

  if (opts.version === null || missing.includes("curl")) {
    checks.push({ id: "download", state: "skip" });
  } else {
    const { github, oss } = parseReleaseReach(output);
    const state =
      github === "ok" || oss === "ok"
        ? "pass"
        : github === "missing" && oss === "missing"
          ? "fail"
          : "warn";
    checks.push({ id: "download", state, version: opts.version, github, oss });
  }

  const freeKb = Number(first("disk"));
  if (!Number.isFinite(freeKb) || first("disk") === "") {
    checks.push({ id: "disk", state: "skip" });
  } else {
    const freeMb = Math.floor(freeKb / 1024);
    const state = freeMb < INSTALL_NEEDS_MB ? "fail" : freeMb < ROOM_MB ? "warn" : "pass";
    checks.push({ id: "disk", state, freeMb, needMb: INSTALL_NEEDS_MB });
  }

  const port = first("port");
  if (port === undefined) {
    checks.push({ id: "port", state: "skip" });
  } else {
    // curl's exit 7 is "could not connect": nothing listens there. Any answer at all — an HTTP
    // status, an empty reply, a reset — is something holding the port.
    const [, exit] = port.split(/\s+/);
    const ours = first("lock") === String(opts.port);
    const holder = exit === "7" ? "free" : ours ? "penguin" : "other";
    checks.push({
      id: "port",
      state: holder === "other" ? "fail" : "pass",
      port: opts.port,
      holder,
    });
  }
  return checks;
}
