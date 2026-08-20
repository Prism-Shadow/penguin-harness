/**
 * Installing this build's server onto another machine, VS Code Remote style: ask the machine
 * what it is, fetch the matching Node runtime, push both it and the install image, and let a
 * Node installer do the rest. No CLI surface — this is the desktop app's own capability,
 * driven from the menu (see menu.ts).
 *
 * Nothing here assumes anything about the far side except an sshd and, for four commands, a
 * shell of some kind. In particular it does NOT use install.sh: that is a POSIX script, and a
 * Windows host cannot run it. The remote gets a runtime of ours at `lib/runtime`, so it does
 * not need Node installed either — which is also why the runtime has to be fetched per
 * platform and arch, and why the identity probe comes first.
 *
 * The remote is left with exactly what a local install leaves: the program directory
 * (`~/.local/share/penguin`, `%LOCALAPPDATA%\penguin`) and, on POSIX, the `~/.local/bin/penguin`
 * symlink. No sudo, no service units, no profile edits, and the data directory is untouched.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanupCommand,
  extractRuntimeCommand,
  makeScratchCommand,
  runInstallerCommand,
  scpArgs,
  sshArgs,
} from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { parseProbeOutput, POSIX_PROBE, WINDOWS_PROBE } from "./detect.js";
import type { RemoteIdentity } from "./detect.js";
import { looksLikeAuthFailure, run } from "./exec.js";
import { packDirectory } from "./pack.js";
import { ensureRuntimeArchive, remoteNodeIsUsable } from "./runtime.js";

/** Name the pack travels under, inside the scratch directory. */
const PACK_NAME = "penguin-image.pack";

export interface PayloadSources {
  /** Directory holding the `penguin/` tree (install-image/, or resources/payload when packaged). */
  payloadRoot: string;
  /** The Node installer that is copied over and run on the far side. */
  installerScript: string;
}

/**
 * Where this app's install image and remote installer live. Packaged builds carry both as
 * extra resources; a dev run reads them out of the repository, so the feature works from
 * `pnpm desktop` without packaging first.
 */
export function resolvePayloadSources(opts: {
  packaged: boolean;
  resourcesPath: string;
  repoRoot: string;
}): PayloadSources {
  return opts.packaged
    ? {
        payloadRoot: path.join(opts.resourcesPath, "payload"),
        installerScript: path.join(opts.resourcesPath, "remote-installer.cjs"),
      }
    : {
        payloadRoot: path.join(opts.repoRoot, "packages", "desktop", "install-image"),
        installerScript: path.join(
          opts.repoRoot,
          "packages",
          "desktop",
          "resources",
          "remote-installer.cjs",
        ),
      };
}

/** Whether the sources are actually present — a dev run that never staged has no image. */
export function payloadSourcesReady(sources: PayloadSources): boolean {
  return (
    fs.existsSync(path.join(sources.payloadRoot, "penguin", "lib", "dist", "penguin.js")) &&
    fs.existsSync(sources.installerScript)
  );
}

/**
 * Asks the machine what it is. POSIX first; a cmd.exe host answers that with an error, which
 * parses as "not a machine I recognize", and the Windows form is tried next. Two round trips
 * at worst, once per install.
 */
export async function detectRemote(
  target: RemoteTarget,
): Promise<{ identity: RemoteIdentity } | { error: string }> {
  for (const probe of [POSIX_PROBE, WINDOWS_PROBE]) {
    const result = await run("ssh", sshArgs(target, probe), { timeoutMs: 30_000 });
    const identity = parseProbeOutput(result.stdout);
    if (identity) return { identity };
    if (result.code !== 0 && looksLikeAuthFailure(result)) {
      return {
        error: `${result.stderr.trim()}\n\nThis app connects with BatchMode: set up key or agent authentication for that host first.`,
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
  | { kind: "installed"; output: string; identity: RemoteIdentity }
  | { kind: "failed"; step: string; detail: string };

/**
 * Pushes and installs. Steps are sequential and each failure stops the run with the far
 * side's own message; the scratch directory is removed on the way out either way, since a
 * leftover image in someone's temp directory is litter we created.
 */
export async function installOnRemote(opts: {
  target: RemoteTarget;
  sources: PayloadSources;
  localVersion: string;
  /** Where verified Node runtimes are kept between installs (app userData). */
  runtimeCacheDir: string;
  fetchBuffer: (url: string) => Promise<Buffer>;
  onProgress?: (line: string) => void;
}): Promise<RemoteInstallOutcome> {
  const { target, sources } = opts;
  const say = opts.onProgress ?? (() => {});

  say("Asking what that machine is…");
  const detected = await detectRemote(target);
  if ("error" in detected) return { kind: "failed", step: "connect", detail: detected.error };
  const { identity } = detected;
  say(`${identity.platform}-${identity.arch}.`);

  if (identity.installedVersion !== null && identity.installedVersion === opts.localVersion) {
    return { kind: "already-installed", version: identity.installedVersion, identity };
  }

  const localTmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-push-"));
  let scratch = "";
  try {
    say("Packing this build…");
    /**
     * A remote with a new enough Node of its own keeps it: no download, no ~30 MB on the
     * wire, and no second runtime installed on a machine that already has one. Only a
     * machine with no node, or one too old to run the program, gets one pushed.
     */
    const useRemoteNode = remoteNodeIsUsable(identity.nodeVersion);
    let packPath: string;
    let runtime: Awaited<ReturnType<typeof ensureRuntimeArchive>> | null = null;
    try {
      packPath = path.join(localTmp, PACK_NAME);
      fs.writeFileSync(packPath, packDirectory(sources.payloadRoot));
      if (useRemoteNode) {
        say(`Using the Node ${identity.nodeVersion} already on that machine.`);
      } else {
        // A runtime that fails verification throws here — before anything has been sent,
        // which is the point: an unverified runtime must never reach someone else's machine.
        runtime = await ensureRuntimeArchive({
          platform: identity.platform,
          arch: identity.arch,
          cacheDir: opts.runtimeCacheDir,
          fetchBuffer: opts.fetchBuffer,
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        });
      }
    } catch (err) {
      return {
        kind: "failed",
        step: "prepare the runtime",
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    // The job the installer reads instead of taking arguments — no second round of quoting.
    const jobPath = path.join(localTmp, "job.json");
    fs.writeFileSync(
      jobPath,
      JSON.stringify({
        packName: PACK_NAME,
        // null tells the installer to leave the machine's own node in charge…
        runtimeDirName: runtime?.artifact.rootDirName ?? null,
        // …and this is the version it will be, so the installer can decide about
        // --experimental-sqlite without asking the machine a second time.
        nodeVersion: runtime ? null : identity.nodeVersion,
      }) + "\n",
    );

    // A scratch name of our own making: hex only, so it needs no quoting on either side.
    const scratchName = `penguin-${randomBytes(6).toString("hex")}`;
    const made = await run(
      "ssh",
      sshArgs(target, makeScratchCommand(identity.platform, scratchName)),
      {
        timeoutMs: 30_000,
      },
    );
    scratch = made.stdout.trim().split("\n").at(-1)?.trim() ?? "";
    if (made.code !== 0 || scratch === "") {
      return {
        kind: "failed",
        step: "prepare",
        detail: made.stderr.trim() || "could not create a scratch directory on the remote",
      };
    }

    say(runtime ? "Copying the build and the runtime…" : "Copying the build…");
    const copy = await run(
      "scp",
      scpArgs(
        target,
        [packPath, jobPath, sources.installerScript, ...(runtime ? [runtime.archivePath] : [])],
        scratch,
      ),
    );
    if (copy.code !== 0) {
      return { kind: "failed", step: "copy", detail: copy.stderr.trim() || "scp failed" };
    }

    if (runtime) {
      say("Unpacking the runtime…");
      const remoteArchive = joinRemote(identity.platform, scratch, runtime.artifact.fileName);
      const extract = await run(
        "ssh",
        sshArgs(target, extractRuntimeCommand(identity.platform, remoteArchive, scratch)),
      );
      if (extract.code !== 0) {
        return {
          kind: "failed",
          step: "unpack the runtime",
          detail: extract.stderr.trim() || `tar exited ${extract.code}`,
        };
      }
    }

    say("Installing…");
    const install = await run(
      "ssh",
      sshArgs(
        target,
        runInstallerCommand(identity.platform, scratch, runtime?.artifact.rootDirName ?? null),
      ),
    );
    if (install.code !== 0) {
      return {
        kind: "failed",
        step: "install",
        detail: `${install.stdout.trim()}\n${install.stderr.trim()}`.trim(),
      };
    }
    return { kind: "installed", output: install.stdout.trim(), identity };
  } finally {
    fs.rmSync(localTmp, { recursive: true, force: true });
    if (scratch !== "") {
      await run("ssh", sshArgs(target, cleanupCommand(identity.platform, scratch)), {
        timeoutMs: 30_000,
      });
    }
  }
}

/** Joins a path the way the REMOTE would, which is not necessarily how this machine would. */
function joinRemote(platform: RemoteIdentity["platform"], ...parts: string[]): string {
  return parts.join(platform === "win32" ? "\\" : "/");
}
