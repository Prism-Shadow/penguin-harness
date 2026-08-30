/**
 * Installing THIS server's build onto another machine, from inside the server process —
 * platform code, so the whole capability travels by hot push (see ../hmr/README.md).
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
import { runInstallScriptCommand, scpArgs, sshArgs, unpackStoreCommand } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { parseProbeOutput, posixProbe, windowsProbe } from "./detect.js";
import type { RemoteLayout } from "./layout.js";
import type { RemoteIdentity, RemotePlatform } from "./detect.js";
import { execFailureText, looksLikeAuthFailure, run, runPiped, runWithInput } from "./exec.js";

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
 * Resolves what this server would install elsewhere.
 *
 * The base release is read from the running install's own tree — the tarball layout
 * (`<root>/lib/dist/penguin.js` under a `lib/`) or the desktop app's staged payload — the
 * same way `penguin --version` would answer. A development checkout has neither, and
 * answers null: it stands on no release the remote could download.
 */
export function resolvePushPlan(
  dataRoot: string | null,
  argv1: string | undefined = process.argv[1],
): PushPlan | null {
  const baseVersion = baseReleaseVersion(argv1);
  if (baseVersion === null) return null;
  let harness: string | null = null;
  let hmrDir: string | null = null;
  if (dataRoot !== null) {
    const dir = path.join(dataRoot, "hmr");
    try {
      const text = fs.readFileSync(path.join(dir, "harness.json"), "utf8").trim();
      if (text !== "") {
        harness = text;
        hmrDir = dir;
      }
    } catch {
      /* never pushed to: the plan is the bare release */
    }
  }
  return {
    baseVersion,
    harness,
    hmrDir,
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
 * Asks the machine what it is. POSIX first; a cmd.exe host answers that with an error, which
 * parses as "not a machine I recognize", and the Windows form is tried next. Two round trips
 * at worst, once per connect.
 */
export async function detectRemote(
  target: RemoteTarget,
  layout: RemoteLayout,
): Promise<{ identity: RemoteIdentity } | { error: string }> {
  for (const probe of [posixProbe(layout), windowsProbe(layout)]) {
    const result = await run("ssh", sshArgs(target, probe), { timeoutMs: 30_000 });
    const identity = parseProbeOutput(result.stdout);
    if (identity) return { identity };
    if (result.code !== 0 && looksLikeAuthFailure(result)) {
      return {
        error: `${result.stderr.trim()}\n\nConnections use BatchMode: set up key or agent authentication for that host first.`,
      };
    }
    // A connection-level failure is fatal for both probes; only an unrecognized ANSWER is
    // worth retrying in the other shell's dialect.
    if (result.code !== 0 && result.stdout.trim() === "" && result.stderr.trim() !== "") {
      const stderr = result.stderr.trim();
      if (!/not recognized|command not found|is not recognized/i.test(stderr)) {
        return { error: stderr };
      }
    }
  }
  return {
    error: "Could not tell what that machine is: neither the POSIX nor the Windows probe answered.",
  };
}

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
}): Promise<RemoteInstallOutcome> {
  const { target, plan, layout } = opts;
  const say = opts.onProgress ?? (() => {});

  let identity = opts.identity;
  if (identity === undefined) {
    say("Asking what that machine is…");
    const detected = await detectRemote(target, layout);
    if ("error" in detected) return { kind: "failed", step: "connect", detail: detected.error };
    identity = detected.identity;
    say(`${identity.platform}-${identity.arch}.`);
  }

  const baseCurrent =
    identity.installedVersion === plan.baseVersion && opts.forceInstaller !== true;
  if (baseCurrent && identity.harness === plan.harness) {
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

      say(`Installing release ${plan.baseVersion} (downloaded on the remote)…`);
      // Where the script ends up decides how it is invoked, so resolve that first and let the
      // command itself say whether stdin has to carry it.
      let where: Parameters<typeof runInstallScriptCommand>[1];
      if (identity.platform === "win32") {
        // A name of our own making: hex only, so it needs no quoting on either side.
        const name = `penguin-${randomBytes(6).toString("hex")}.ps1`;
        const local = path.join(os.tmpdir(), name);
        fs.writeFileSync(local, installer);
        windowsTmp = { local, remote: `%USERPROFILE%\\${name}` };
        const copy = await run("scp", scpArgs(target, [local], "."));
        if (copy.code !== 0) {
          return { kind: "failed", step: "copy", detail: copy.stderr.trim() || "scp failed" };
        }
        where = { platform: "win32", scriptPath: windowsTmp.remote };
      } else {
        where = { platform: identity.platform };
      }
      const step = runInstallScriptCommand(`v${plan.baseVersion}`, where, layout);
      // One connection when the script rides stdin, and the far side's own progress is
      // relayed as it arrives rather than after the minutes an install can take.
      const install = step.scriptOnStdin
        ? await runWithInput("ssh", sshArgs(target, step.command), {
            input: installer,
            onLine: say,
          })
        : await run("ssh", sshArgs(target, step.command));
      if (install.code !== 0) {
        return {
          kind: "failed",
          step: "install",
          detail: `${install.stdout.trim()}\n${install.stderr.trim()}`.trim(),
        };
      }
      output.push(install.stdout.trim());
    }

    if (plan.hmrDir !== null && identity.harness !== plan.harness) {
      say("Replicating the pushed version…");
      // harness.json and store/ only: uploads/ is this machine's scratch, not state.
      const sync = await runPiped(
        { file: "tar", args: ["-czf", "-", "-C", plan.hmrDir, "harness.json", "store"] },
        { file: "ssh", args: sshArgs(target, unpackStoreCommand(identity.platform, layout)) },
      );
      if (sync.code !== 0) {
        return {
          kind: "failed",
          step: "replicate the pushed version",
          detail: sync.stderr.trim() || `tar | ssh exited ${sync.code}`,
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
    const after = await detectRemote(target, layout);
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

    return { kind: "installed", output: output.join("\n").trim(), identity: after.identity };
  } finally {
    // Nothing to clean on a POSIX remote: the installer was never a file there. A Windows
    // one deletes its own copy as part of the install command; this is the local original.
    if (windowsTmp !== null) fs.rmSync(windowsTmp.local, { force: true });
  }
}
