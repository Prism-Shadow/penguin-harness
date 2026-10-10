/**
 * Installing THIS server's build onto another machine, from inside the server process —
 * platform code, so the whole capability travels by hot push (see packages/hmr/README.md).
 *
 * Nothing installable is produced here. The far side runs the ordinary release installer
 * ONLINE, pinned to this server's own base release, so the program tree — launchers, libs,
 * web assets, bundled runtime — is the standard artifact downloaded from the release
 * sources, exactly as a person installing by hand would get it. What this code adds is only
 * what makes the remote THIS machine's peer rather than a stock install: the hmr state
 * (harness.json + store/) is streamed across afterwards, so the remote's next boot runs the
 * same pushed platform, web and CLI this server runs (hmr/host.ts's restore).
 *
 * The remote therefore needs its own route to the release sources (GitHub or the OSS
 *  mirror); the ssh channel carries only the installer script and the store.
 *
 * The remote is left with exactly what a local install plus a push leaves: the program
 * directory, the `~/.local/bin/penguin` symlink on POSIX, and the data root's hmr/ state.
 * No sudo, no service units, no profile edits, and the rest of the data root is untouched.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { runInstallScriptCommand, unpackStoreCommand } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { parseProbeOutput, posixProbe, windowsProbe } from "./detect.js";
import type { RemoteIdentity, RemotePlatform } from "./detect.js";
import type { RemoteLayout } from "./layout.js";
import { connectionTo } from "./transport/index.js";
import { sshFailureText, sshRefusal } from "./ssh-failure.js";
import { parseReleaseReach, releaseReachCommand } from "./diagnose.js";
import type { MachineChannel } from "./transport/index.js";

/**
 * The hmr state an install replicates — `harness.json` and `store/` of `hmrDir` — as one
 * tar.gz, packed in this process rather than by this machine's `tar`.
 *
 * In process because the far side is another kind of machine. macOS's bsdtar adds an
 * AppleDouble `._<name>` member for every file that carries extended attributes (which
 * files written on a Mac usually do: `com.apple.provenance`), and the far side extracts
 * those as files: an `archives/._node-pty.tgz` beside the real archive is then "an
 * archive" the platform tries to unpack at boot. `portable` also drops this machine's
 * owners and ids, which mean nothing over there. Modes are kept: an exec bit is the one
 * piece of metadata the store needs (hmr/pushed-build.ts).
 */
export async function packHmrState(hmrDir: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = tar.c({ gzip: true, cwd: hmrDir, portable: true }, ["harness.json", "store"]);
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** The uplink a transfer's deadline is sized for: a slow home line, 256 kbit/s. */
const SLOW_UPLINK_BYTES_PER_SECOND = 32 * 1024;

/**
 * How long sending `payload` over the session may take before it counts as hung: the bulk
 * default, or longer for a payload that would not cross a slow uplink in it — base64 on the
 * wire (4/3), which is how the session carries stdin (transport/ssh-session.ts).
 */
export function transferTimeoutMs(payload: Buffer): number {
  const seconds = (payload.byteLength * 4) / 3 / SLOW_UPLINK_BYTES_PER_SECOND;
  return Math.max(10 * 60_000, Math.ceil(seconds * 1000));
}

/**
 * One line of the installer's output as a person should see it in the job log, or null for
 * none. curl's progress bar redraws itself with carriage returns, so its whole run arrives as
 * one "line" of bars and percentages: what a terminal would show is the last redraw, and a
 * bare bar says nothing the next line ("Bundle checksum OK.") does not.
 */
export function installerLine(raw: string): string | null {
  const shown = raw
    .split("\r")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .pop();
  if (shown === undefined) return null;
  if (/^[#=O\-\s]*\d+(?:\.\d+)?%$/.test(shown) || /^[#=O\-\s]+$/.test(shown)) return null;
  return shown;
}

/**
 * Why the installer stopped, as its own words: its `error:` lines when it said any (every
 * refusal it makes is one — install.sh's `fail`), else its last few lines. The whole
 * transcript is already in the job log, line by line; a failure's message is what it says.
 */
export function installerFailure(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => installerLine(line))
    .filter((line): line is string => line !== null);
  const errors = lines.filter((line) => /^error:/i.test(line));
  const said = (errors.length > 0 ? errors : lines.slice(-3)).join("\n");
  return said === "" ? "the installer stopped without a message." : said;
}

/** Which installer runs the far side; also the asset keys deploy.mjs pushes. */
const installerFileFor = (platform: RemotePlatform): string =>
  platform === "win32" ? "install.ps1" : "install.sh";

/** The version out of a lib/package.json path, or null when it is not a manifest. */
function versionOfManifest(manifestPath: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version !== "") return version;
    }
  } catch {
    /* absent or damaged: not an install */
  }
  return null;
}

/**
 * What an install would put on the remote: the release this server stands on, plus the hmr
 * state to replicate over it (null when nothing was ever pushed here). `version` is the
 * display form the page and the install records use.
 */
export interface PushPlan {
  /** The base release's version as lib/package.json spells it (no `v`). */
  baseVersion: string;
  /** Raw harness.json text of this server's own hmr state, or null when none exists. */
  harness: string | null;
  /** The hmr directory the store is streamed from; null exactly when `harness` is. */
  hmrDir: string | null;
  version: string;
}

/**
 * The pushed-state suffix for a display version: the platform bundle's content sha out of a
 * harness.json (`store/platform/<sha>.mjs`), shortened. Falls back to a bare marker for a
 * manifest whose shape this build does not recognize — the suffix is display, not identity;
 * equality checks compare the harness text itself.
 */
function harnessSuffix(harnessText: string): string {
  try {
    const parsed = JSON.parse(harnessText) as { platform?: { bundle?: string } };
    const sha = /([0-9a-f]{8,})\.mjs$/.exec(parsed.platform?.bundle ?? "")?.[1];
    if (sha !== undefined) return `+hmr.${sha.slice(0, 12)}`;
  } catch {
    /* fall through */
  }
  return "+hmr";
}

/**
 * Whether two harness.json texts name the same build: the same platform, CLI, web and assets
 * files — the parts, not the record. A machine that took a build through its update channel
 * writes a harness.json of its own, with its own `pushedAt`, so one build reads as two texts
 * on two machines while the content-named files they point at are the same. A text this build
 * cannot read as a harness is compared as text.
 */
export function sameBuild(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const parts = (text: string): string => {
    try {
      const h = JSON.parse(text) as {
        platform?: { bundle?: unknown };
        cli?: { bundle?: unknown };
        web?: { manifest?: unknown };
        assets?: { dir?: unknown };
      };
      if (typeof h.platform?.bundle !== "string") return text;
      return JSON.stringify([
        h.platform.bundle,
        h.cli?.bundle ?? null,
        h.web?.manifest ?? null,
        h.assets?.dir ?? null,
      ]);
    } catch {
      return text;
    }
  };
  return parts(a) === parts(b);
}

/**
 * Resolves what this server would install elsewhere.
 *
 * The base release is read from the running install's own tree — the tarball layout
 * (`<root>/lib/dist/penguin.js` under a `lib/`) or the desktop app's staged payload — the
 * same way `penguin --version` would answer. A development checkout has neither, and
 * answers null here: it stands on no installed release, and builds its image on demand
 * instead (checkout-image.ts).
 */
export function resolvePushPlan(
  dataRoot: string | null,
  argv1: string | undefined = process.argv[1],
): PushPlan | null {
  const baseVersion = baseReleaseVersion(argv1);
  if (baseVersion === null) return null;
  return planOver(baseVersion, dataRoot === null ? null : path.join(dataRoot, "hmr"));
}

/**
 * A plan for this base release plus whatever hmr state `hmrDir` holds — the bare release
 * when it holds none. The one place a plan's version is spelled, for a packaged server's own
 * store and a checkout's image alike.
 */
export function planOver(baseVersion: string, hmrDir: string | null): PushPlan {
  let harness: string | null = null;
  if (hmrDir !== null) {
    try {
      const text = fs.readFileSync(path.join(hmrDir, "harness.json"), "utf8").trim();
      if (text !== "") harness = text;
    } catch {
      /* never pushed to: the plan is the bare release */
    }
  }
  return {
    baseVersion,
    harness,
    hmrDir: harness === null ? null : hmrDir,
    version: harness === null ? baseVersion : baseVersion + harnessSuffix(harness),
  };
}

/**
 * The base release version around the process entry, or null when this process stands on no
 * published release. Read from disk rather than from the running artifact's own build info,
 * because a hot-pushed server must still report the BASE it was installed from.
 */
function baseReleaseVersion(argv1: string | undefined): string | null {
  if (!argv1 || path.basename(path.dirname(argv1)) !== "dist") return null;
  const parent = path.dirname(path.dirname(argv1));

  // Tarball install: <root>/lib/dist/<entry>.js. lib/package.json is the CLI package's own
  // manifest, and keeps naming the base release while this process runs a pushed bundle.
  if (path.basename(parent) === "lib") {
    return versionOfManifest(path.join(parent, "package.json"));
  }

  // Packaged desktop app: <resources>/app/dist/server.js — the app forks the server as one
  // bundled file (packages/desktop/tsup.config.ts), and asar is off, so these are real files.
  // The app's own manifest names the release it was published under, app and tarballs
  // shipping from one tag. A source run sits at packages/desktop rather than under
  // resources/, and is deliberately unmatched: it stands on no release a remote could fetch.
  if (path.basename(parent) === "app" && path.basename(path.dirname(parent)) === "resources") {
    return versionOfManifest(path.join(parent, "package.json"));
  }
  return null;
}

/**
 * Asks the machine what it is. POSIX first, over the session — the only round trip a POSIX
 * host ever costs. A cmd.exe host has no `sh` to hold a session on, so the session dies
 * unopened and the Windows form is asked on a connection of its own. Two round trips at
 * worst, once per connect.
 */
export async function detectRemote(
  target: RemoteTarget,
  layout: RemoteLayout,
  channel?: MachineChannel,
): Promise<{ identity: RemoteIdentity } | { error: string }> {
  const conn = channel ?? connectionTo(target);
  const posix = await conn.exec(posixProbe(layout));
  const identity = parseProbeOutput(posix.stdout);
  if (identity) return { identity };
  // The session's output is merged, so ssh's own words arrive as stdout.
  const said = posix.stdout.trim();
  // ssh itself got no session — a host key, a key, a name, a route — so there is no shell to
  // ask in either dialect, and a second connection would only wait for the same refusal. The
  // transport leads such words with what they mean (ssh-session.ts); said again here only
  // when they did not come through it.
  const refused = posix.code !== 0 ? sshRefusal(said, target.alias) : null;
  if (refused !== null) return { error: refused };
  const windows = await conn.oneShot(windowsProbe(layout), { timeoutMs: 30_000 });
  const identityWin = parseProbeOutput(windows.stdout);
  if (identityWin) return { identity: identityWin };
  const refusedWin = windows.code !== 0 ? sshFailureText(windows.stderr, target.alias) : null;
  if (refusedWin !== null) return { error: refusedWin };
  const words = said || windows.stderr.trim();
  return {
    error:
      "Could not tell what that machine is: neither the POSIX nor the Windows probe answered." +
      (words === "" ? "" : ` It said: ${words}`),
  };
}

/**
 * Fetches release `version`'s package for `target` (`linux-x64`, `darwin-arm64`…) on this
 * side: its file, or why there is none.
 */
export type CarryRelease = (
  version: string,
  target: string,
) => Promise<{ ok: true; file: string } | { ok: false; detail: string }>;

/** A scratch directory name mktemp made over there: absolute, and nothing a shell would read. */
const SCRATCH_DIR = /^\/[A-Za-z0-9._/-]+$/;

export type RemoteInstallOutcome =
  | { kind: "already-installed"; version: string; identity: RemoteIdentity }
  /**
   * The base release over there already matches; only the pushed state differs. Nothing to
   * INSTALL — this is a hot update, and the machine has a channel for it that answers
   * (machines/upgrade.ts). The caller routes it there rather than this path copying the
   * store over and restarting the process, which replaces a running server without ever
   * asking whether it can run what it was handed.
   */
  | { kind: "state-only"; identity: RemoteIdentity }
  | { kind: "installed"; output: string; identity: RemoteIdentity }
  | { kind: "failed"; step: string; detail: string };

/**
 * Installs the plan. Steps are sequential and each failure stops the run with the far side's
 * own message; the scratch directory is removed on the way out either way, since a leftover
 * script in someone's temp directory is litter we created.
 */
export async function installOnRemote(opts: {
  target: RemoteTarget;
  plan: PushPlan;
  onProgress?: (line: string) => void;
  /** Identity from an earlier probe in the same flow, to save the round trips. */
  identity?: RemoteIdentity;
  /** The hmr capability's assetsDir accessor: where a pushed bundle's assets were unpacked. */
  assets?: () => string | null;
  /** The channel to the machine; a test hands in a scripted one. */
  channel?: MachineChannel;
  /**
   * Run the installer even when the release over there already matches.
   *
   * For the case the short-circuit below gets wrong: a machine whose PROGRAM is the right
   * version and whose hmr store this server cannot reach — an empty store, or one holding a
   * build that cannot receive an update. Nothing about the versions says so, so this is asked
   * for and never inferred. The installer replicates the store on its way through, which is
   * what puts the machine back within reach.
   */
  forceInstaller?: boolean;
  /** Which installation on that machine this is: the profile's program directory and root. */
  layout: RemoteLayout;
  /**
   * The release package for a machine that cannot download it itself — fetched (or read
   * from cache) on THIS side, as a local file (machines/release-cache.ts). Absent, a POSIX
   * install is not checked for reach: the installer downloads, or fails in its own words.
   */
  carryRelease?: CarryRelease;
}): Promise<RemoteInstallOutcome> {
  const { target, plan, layout } = opts;
  const conn = opts.channel ?? connectionTo(target);
  const say = opts.onProgress ?? (() => {});

  let identity = opts.identity;
  if (identity === undefined) {
    say("Asking what that machine is…");
    const detected = await detectRemote(target, layout, conn);
    if ("error" in detected) return { kind: "failed", step: "connect", detail: detected.error };
    identity = detected.identity;
    say(`${identity.platform}-${identity.arch}.`);
  }

  const baseCurrent =
    identity.installedVersion === plan.baseVersion && opts.forceInstaller !== true;
  if (baseCurrent && sameBuild(identity.harness, plan.harness)) {
    return { kind: "already-installed", version: plan.version, identity };
  }
  if (baseCurrent) {
    // Same release, different pushed state: a hot update, not an install. Handing it over
    // as files and restarting the process would swap the code under a server that may not
    // be able to claim it — a runtime older than the pushed platform warns, falls back to
    // its packaged default, and carries on serving, so the restart looks like a success
    // from here and the machine is recorded at a version it is not running. The update
    // channel asks the machine itself and comes back with its answer, refusals included.
    return { kind: "state-only", identity };
  }

  // Release tags are v-prefixed semver; a base that does not spell one cannot be pinned —
  // notably 0.0.0-hmr.* trees, which stand on no published release.
  if (
    !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(plan.baseVersion) ||
    plan.baseVersion.startsWith("0.0.0")
  ) {
    return {
      kind: "failed",
      step: "resolve the release",
      detail: `this install's own version (${plan.baseVersion}) does not name a published release.`,
    };
  }

  let windowsTmp: { local: string; remote: string } | null = null;
  /** A scratch directory over there holding a carried release package, removed on the way out. */
  let scratch: string | null = null;
  try {
    const output: string[] = [];
    if (!baseCurrent) {
      // The ordinary installer. Where it sits follows from what this server is: a hot-pushed
      // bundle has it among the assets published with that same version, anything else is a
      // packaged install and it is beside this module (dist/ after a build; this package's
      // tsup.config.ts copies it there).
      const installerFile = installerFileFor(identity.platform);
      const installerHome = opts.assets?.() ?? path.dirname(fileURLToPath(import.meta.url));
      let installer: Buffer;
      try {
        installer = fs.readFileSync(path.join(installerHome, installerFile));
      } catch (err) {
        return {
          kind: "failed",
          step: "prepare the installer",
          detail: err instanceof Error ? err.message : String(err),
        };
      }

      say(`Installing release ${plan.baseVersion}…`);
      // Where the script ends up decides how it is invoked, so resolve that first and let the
      // command itself say whether stdin has to carry it.
      let where: Parameters<typeof runInstallScriptCommand>[1];
      if (identity.platform === "win32") {
        // A name of our own making: hex only, so it needs no quoting on either side.
        const name = `penguin-${randomBytes(6).toString("hex")}.ps1`;
        const local = path.join(os.tmpdir(), name);
        fs.writeFileSync(local, installer);
        windowsTmp = { local, remote: `%USERPROFILE%\\${name}` };
        const copy = await conn.copyTo([local], ".");
        if (copy.code !== 0) {
          return { kind: "failed", step: "copy", detail: copy.stderr.trim() || "scp failed" };
        }
        where = { platform: "win32", scriptPath: windowsTmp.remote };
      } else {
        where = { platform: identity.platform };
      }
      // Where the release comes from. The machine downloads it itself when it reaches GitHub
      // or the mirror; when it reaches neither — an air-gapped host, a network that blocks
      // both — this side fetches the package and carries it over the session, and the
      // installer installs that file (`--archive`) with no network at all.
      let release: string | { archive: string } = `v${plan.baseVersion}`;
      if (identity.platform !== "win32" && opts.carryRelease !== undefined) {
        const carried = await carryOver(
          conn,
          target,
          plan.baseVersion,
          identity,
          opts.carryRelease,
          say,
        );
        if ("failed" in carried) return { kind: "failed", ...carried.failed };
        if (carried.archive !== null) {
          scratch = carried.scratch;
          release = { archive: carried.archive };
        }
      }
      const step = runInstallScriptCommand(release, where, layout);
      // The script rides the session's stdin as a heredoc, and the far side's own progress
      // is relayed as it arrives rather than after the minutes an install can take. A Windows
      // host runs its copied script on a connection of its own (no session to ride).
      const install = step.scriptOnStdin
        ? await conn.stream(step.command, {
            input: installer,
            onLine: (line) => {
              const shown = installerLine(line);
              if (shown !== null) say(shown);
            },
          })
        : await conn.oneShot(step.command);
      if (install.code !== 0) {
        return {
          kind: "failed",
          step: "install",
          detail: installerFailure(`${install.stdout}\n${install.stderr}`),
        };
      }
      output.push(install.stdout.trim());
    }

    if (plan.hmrDir !== null && !sameBuild(identity.harness, plan.harness)) {
      say("Replicating the pushed version…");
      // harness.json and store/ only: uploads/ is this machine's scratch, not state. Packed
      // here, then handed to the machine's tar on the session's stdin.
      let packed: Buffer;
      try {
        packed = await packHmrState(plan.hmrDir);
      } catch (err) {
        return {
          kind: "failed",
          step: "replicate the pushed version",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      say(`Sending it (${(packed.byteLength / 1048576).toFixed(1)} MB)…`);
      const unpack = unpackStoreCommand(identity.platform, layout);
      const sync =
        identity.platform === "win32"
          ? await conn.oneShot(unpack, { input: packed })
          : await conn.stream(unpack, { input: packed, timeoutMs: transferTimeoutMs(packed) });
      if (sync.code !== 0) {
        return {
          kind: "failed",
          step: "replicate the pushed version",
          detail:
            `${sync.stdout.trim()}\n${sync.stderr.trim()}`.trim() || `tar exited ${sync.code}`,
        };
      }
      output.push(`Pushed version replicated (${plan.version}).`);
    }

    // ASK THE MACHINE what it now has, rather than reporting what we meant to put there.
    // Every step above answers for itself — the installer exited 0, the store unpacked — and
    // none of them answers the only question that matters, which is whether the thing on
    // disk over there is now this version. An install that ran cleanly and changed nothing
    // (wrong home, a package manager that declined, a path the installer did not own) would
    // otherwise be recorded as a success at OUR version, and that record is what
    // syncOutOfDate filters on: the machine is then excluded from the very sweep that would
    // have tried again. A false success here does not just mislead, it seals itself in.
    say("Checking what it ended up with…");
    const after = await detectRemote(target, layout, conn);
    if ("error" in after) {
      return {
        kind: "failed",
        step: "verify the install",
        detail: `the install ran, but the machine could not be asked what it now has: ${after.error}`,
      };
    }
    if (after.identity.installedVersion !== plan.baseVersion) {
      return {
        kind: "failed",
        step: "verify the install",
        detail:
          `the install reported success, but the machine still has ` +
          `${after.identity.installedVersion ?? "no install"} where ${plan.baseVersion} was expected.`,
      };
    }
    // The base is only half of what gets recorded. A plan carrying a pushed state is recorded
    // at `plan.version`, which is the base plus that state's content sha — so a store whose
    // unpack exited 0 without landing (a partial tarball, a data root somewhere else, a
    // harness.json the far side could not replace) would seal the machine in at a version it
    // is not running. This is the comparison the entry gate above already makes; the machine
    // has to still make it true afterwards. Scoped to a plan that HAD a pushed state: a
    // base-only install neither carries nor removes one, and must not be failed for a remote
    // hmr directory it was never asked to touch.
    if (plan.hmrDir !== null && !sameBuild(after.identity.harness, plan.harness)) {
      return {
        kind: "failed",
        step: "verify the install",
        detail:
          "the install reported success, but the pushed version is not what the machine ended " +
          `up with: it reports ${after.identity.harness === null ? "no pushed state" : "a different one"}.`,
      };
    }

    return { kind: "installed", output: output.join("\n").trim(), identity: after.identity };
  } finally {
    // Nothing else to clean on a POSIX remote: the installer was never a file there. A
    // Windows one deletes its own copy as part of the install command; this is the local
    // original.
    if (windowsTmp !== null) fs.rmSync(windowsTmp.local, { force: true });
    if (scratch !== null) await conn.exec(`rm -rf "${scratch}"`);
  }
}

/**
 * Settles where a POSIX machine's release comes from: nothing to carry when it reaches a
 * source (`archive: null`), a refusal when both sources answered and neither has the release,
 * else the package fetched here and sent into a scratch directory there.
 */
async function carryOver(
  conn: MachineChannel,
  target: RemoteTarget,
  version: string,
  identity: RemoteIdentity,
  carryRelease: CarryRelease,
  say: (line: string) => void,
): Promise<
  | { archive: null }
  | { archive: string; scratch: string }
  | { failed: { step: string; detail: string } }
> {
  const platform = `${identity.platform}-${identity.arch}`;
  const asked = await conn.exec(releaseReachCommand(version));
  const reach = parseReleaseReach(asked.stdout);
  if (reach.oss === "ok" || reach.github === "ok") return { archive: null };
  if (reach.oss === "missing" && reach.github === "missing") {
    return {
      failed: {
        step: "download the release",
        detail:
          `release v${version} has no ${platform} package on GitHub or the mirror — it is not ` +
          `published (yet). A source checkout installs the release its VERSION names.`,
      },
    };
  }
  say(
    `${target.alias} cannot reach GitHub or the release mirror; fetching release ${version} ` +
      `for ${platform} here to send it over ssh…`,
  );
  const fetched = await carryRelease(version, platform);
  if (!fetched.ok) {
    return {
      failed: {
        step: "download the release",
        detail:
          `${target.alias} cannot reach GitHub or the release mirror, and this computer could ` +
          `not fetch release ${version} for it either: ${fetched.detail}`,
      },
    };
  }
  const made = await conn.exec(`mktemp -d "\${TMPDIR:-/tmp}/penguin-release.XXXXXX"`);
  const scratch = made.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (made.code !== 0 || !SCRATCH_DIR.test(scratch)) {
    return {
      failed: {
        step: "send the release",
        detail: `could not make a scratch directory there: ${made.stdout.trim() || "mktemp said nothing"}`,
      },
    };
  }
  const bytes = fs.readFileSync(fetched.file);
  const archive = `${scratch}/${path.basename(fetched.file)}`;
  say(`Sending release ${version} (${(bytes.byteLength / 1048576).toFixed(1)} MB)…`);
  const sent = await conn.stream(`cat > "${archive}"`, {
    input: bytes,
    timeoutMs: transferTimeoutMs(bytes),
  });
  if (sent.code !== 0) {
    await conn.exec(`rm -rf "${scratch}"`);
    return {
      failed: {
        step: "send the release",
        detail: sent.stdout.trim() || `the copy exited ${sent.code}`,
      },
    };
  }
  return { archive, scratch };
}
