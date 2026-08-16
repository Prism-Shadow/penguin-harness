/**
 * Installing this build's server onto another machine, VS Code Remote style: probe the host,
 * decide, push the install image, run the installer there. No CLI surface — this is the
 * desktop app's own capability, driven from the menu (see menu.ts).
 *
 * What travels is the tree stage.mjs stages next to the packaged app (`{bin,lib,lib/web}`,
 * the universal shape) plus the repository's own install.sh, which already knows how to
 * stage, swap, smoke-test and roll back an install and never touches the data directory.
 * Nothing is assembled by hand on the far side: the payload is a tarball, and install.sh
 * does the rest.
 *
 * The remote is left with exactly what an ordinary install leaves: `~/.local/share/penguin`
 * plus the `~/.local/bin/penguin` symlink. No sudo, no systemd unit, no profile edits — the
 * boundary the design draws around "we do not maintain that machine".
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanupCommand,
  installCommand,
  MAKE_TEMP_DIR_COMMAND,
  scpArgs,
  sshArgs,
} from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { looksLikeAuthFailure, run } from "./exec.js";
import { parseProbe, planRemoteInstall, PROBE_COMMAND } from "./probe.js";
import type { InstallAction, RemoteProbe } from "./probe.js";

/** The archive name install.sh recognizes as a payload. */
const PAYLOAD_ARCHIVE = "payload.tar.gz";

export interface PayloadSources {
  /** Directory holding the `penguin/` tree (stage/payload, or resources/payload when packaged). */
  payloadRoot: string;
  /** The installer script that is copied over and run on the far side. */
  installerPath: string;
}

/**
 * Where this app's install image and installer live. Packaged builds carry both as extra
 * resources; a dev run reads them out of the repository, so the feature works from
 * `pnpm desktop` without packaging first.
 */
export function resolvePayloadSources(opts: {
  packaged: boolean;
  resourcesPath: string;
  repoRoot: string;
}): PayloadSources {
  if (opts.packaged) {
    return {
      payloadRoot: path.join(opts.resourcesPath, "payload"),
      installerPath: path.join(opts.resourcesPath, "install.sh"),
    };
  }
  return {
    payloadRoot: path.join(opts.repoRoot, "packages", "desktop", "stage", "payload"),
    installerPath: path.join(opts.repoRoot, "install.sh"),
  };
}

/** Whether the sources are actually present — a dev run that never staged has neither. */
export function payloadSourcesReady(sources: PayloadSources): boolean {
  return (
    fs.existsSync(path.join(sources.payloadRoot, "penguin", "bin", "penguin")) &&
    fs.existsSync(sources.installerPath)
  );
}

/**
 * Packs `<payloadRoot>/penguin` into a tarball plus the `.sha256` install.sh verifies. Uses
 * the system tar (present on macOS, Linux and Windows 10+) rather than a bundled
 * implementation: it is one call, and the format has to match what install.sh untars.
 */
export async function packPayload(
  sources: PayloadSources,
  outDir: string,
): Promise<{ archivePath: string; checksumPath: string }> {
  const archivePath = path.join(outDir, PAYLOAD_ARCHIVE);
  const tar = await run("tar", ["-czf", archivePath, "-C", sources.payloadRoot, "penguin"]);
  if (tar.code !== 0) {
    throw new Error(
      `could not pack the install image: ${tar.stderr.trim() || `tar exited ${tar.code}`}`,
    );
  }
  const hash = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  const checksumPath = `${archivePath}.sha256`;
  // The format shasum/sha256sum print, which is what install.sh's verifier reads.
  fs.writeFileSync(checksumPath, `${hash}  ${PAYLOAD_ARCHIVE}\n`);
  return { archivePath, checksumPath };
}

export type RemoteInstallOutcome =
  | { kind: "already-installed"; version: string }
  | { kind: "installed"; output: string }
  | { kind: "blocked"; detail: string }
  | { kind: "failed"; step: string; detail: string };

/** Probes a target and reports both the raw answer and the decision it implies. */
export async function probeRemote(
  target: RemoteTarget,
  localVersion: string,
): Promise<{ probe: RemoteProbe; plan: InstallAction } | { error: string }> {
  const result = await run("ssh", sshArgs(target, PROBE_COMMAND), { timeoutMs: 30_000 });
  if (result.code !== 0 && result.stdout.trim() === "") {
    const hint = looksLikeAuthFailure(result)
      ? "\n\nThis app connects with BatchMode: set up key or agent authentication for that host first."
      : "";
    return { error: `${result.stderr.trim() || `ssh exited ${result.code}`}${hint}` };
  }
  const probe = parseProbe(result.stdout);
  return { probe, plan: planRemoteInstall(probe, localVersion) };
}

/**
 * Pushes and installs. Steps are sequential and each failure stops the run with the far
 * side's own message; the scratch directory is removed on the way out either way, since a
 * leftover tarball in someone's /tmp is litter we created.
 */
export async function installOnRemote(opts: {
  target: RemoteTarget;
  sources: PayloadSources;
  localVersion: string;
  /** Progress for the UI; each line is already user-readable. */
  onProgress?: (line: string) => void;
}): Promise<RemoteInstallOutcome> {
  const { target, sources } = opts;
  const say = opts.onProgress ?? (() => {});

  const probed = await probeRemote(target, opts.localVersion);
  if ("error" in probed) return { kind: "failed", step: "probe", detail: probed.error };
  if (probed.plan.action === "blocked") {
    return { kind: "blocked", detail: probed.plan.detail };
  }
  if (probed.plan.action === "use") {
    return { kind: "already-installed", version: probed.plan.remoteVersion };
  }
  say(
    probed.plan.reason === "absent"
      ? "No PenguinHarness there yet — installing."
      : `Replacing PenguinHarness ${probed.plan.remoteVersion} with ${opts.localVersion}.`,
  );

  const localTmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-push-"));
  let remoteTmp = "";
  try {
    say("Packing this build…");
    const { archivePath, checksumPath } = await packPayload(sources, localTmp);

    const temp = await run("ssh", sshArgs(target, MAKE_TEMP_DIR_COMMAND), { timeoutMs: 30_000 });
    remoteTmp = temp.stdout.trim();
    if (temp.code !== 0 || remoteTmp === "") {
      return {
        kind: "failed",
        step: "prepare",
        detail: temp.stderr.trim() || "could not create a scratch directory on the remote",
      };
    }

    say("Copying…");
    const copy = await run(
      "scp",
      scpArgs(target, [archivePath, checksumPath, sources.installerPath], remoteTmp),
    );
    if (copy.code !== 0) {
      return { kind: "failed", step: "copy", detail: copy.stderr.trim() || "scp failed" };
    }

    say("Installing…");
    const install = await run("ssh", sshArgs(target, installCommand(remoteTmp, PAYLOAD_ARCHIVE)));
    if (install.code !== 0) {
      return {
        kind: "failed",
        step: "install",
        detail: `${install.stdout.trim()}\n${install.stderr.trim()}`.trim(),
      };
    }
    return { kind: "installed", output: install.stdout.trim() };
  } finally {
    fs.rmSync(localTmp, { recursive: true, force: true });
    if (remoteTmp !== "") {
      // Best effort: the install already succeeded or failed on its own terms.
      await run("ssh", sshArgs(target, cleanupCommand(remoteTmp)), { timeoutMs: 30_000 });
    }
  }
}
