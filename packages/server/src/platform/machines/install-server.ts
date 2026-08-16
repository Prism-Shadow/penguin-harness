/**
 * Installing THIS server's build onto another machine, from inside the server process —
 * platform code, so the whole capability travels by hot push (see ../../hmr/README.md).
 *
 * What gets pushed is the running install itself: a server always sits inside a universal
 * image — the tarball layout (`…/penguin/{bin,lib}`) or the desktop app's staged payload —
 * so the payload is packed straight from disk, version-stamped by its own lib/package.json.
 * That is what makes "the two ends must match" trivially true: the far side receives the
 * bytes this side runs.
 *
 * Nothing here assumes anything about the far side except an sshd and, for four commands, a
 * shell of some kind. The installer that does the real work is embedded as text
 * (installer-script.ts) and runs over there on a Node runtime that is either the remote's
 * own (new enough) or fetched, verified and pushed alongside.
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
import { REMOTE_INSTALLER_SCRIPT } from "./installer-script.js";
import { packDirectory } from "./pack.js";
import { ensureRuntimeArchive, remoteNodeIsUsable } from "./runtime.js";

/** Name the pack travels under, inside the scratch directory. */
const PACK_NAME = "penguin-image.pack";

/**
 * Where this running server's pushable image is, and how to pack it. `version` is read from
 * the image's own lib/package.json — the thing actually sent, not what any package here
 * believes about itself.
 */
export interface PayloadImage {
  version: string;
  pack: () => Buffer;
}

/** The version out of a lib/package.json path, or null when it is not a manifest. */
function versionOfManifest(manifestPath: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version !== "") return version;
    }
  } catch {
    /* absent or damaged: not an image */
  }
  return null;
}

/**
 * Finds the install image around the running process. Two real shapes, probed in order:
 *
 * 1. **Tarball install** — the CLI entry is `<root>/lib/dist/penguin.js` and `<root>` is the
 *    program directory itself; pack it under a `penguin/` prefix, leaving out `lib/runtime`
 *    (this machine's Node must not ride along in a universal image) and `bin` (the installer
 *    writes fresh launchers).
 * 2. **Desktop app** — the server entry is
 *    `<resources>/app/node_modules/@prismshadow/penguin-server/dist/index.js` and the staged
 *    universal image sits beside it at `<resources>/payload/penguin`.
 *
 * A dev checkout has neither and answers null: `node packages/desktop/scripts/stage.mjs`
 * plus a desktop run, or an installed build, are the shapes that can push themselves.
 */
export function resolvePayloadImage(
  argv1: string | undefined = process.argv[1],
): PayloadImage | null {
  if (!argv1) return null;

  // Tarball shape: <root>/lib/dist/<entry>.js
  const libDir = path.dirname(path.dirname(argv1));
  const root = path.dirname(libDir);
  if (path.basename(libDir) === "lib" && path.basename(path.dirname(argv1)) === "dist") {
    const version = versionOfManifest(path.join(libDir, "package.json"));
    if (version !== null) {
      return {
        version,
        pack: () => packDirectory(root, { prefix: "penguin", exclude: ["lib/runtime", "bin"] }),
      };
    }
  }

  // Desktop shape: walk up to node_modules/@prismshadow/penguin-server, then to resources/.
  let dir = path.dirname(argv1);
  for (;;) {
    if (
      path.basename(dir) === "penguin-server" &&
      path.basename(path.dirname(dir)) === "@prismshadow" &&
      path.basename(path.dirname(path.dirname(dir))) === "node_modules"
    ) {
      const appDir = path.dirname(path.dirname(path.dirname(dir)));
      const payloadRoot = path.join(path.dirname(appDir), "payload");
      const version = versionOfManifest(path.join(payloadRoot, "penguin", "lib", "package.json"));
      if (version === null) return null;
      return { version, pack: () => packDirectory(payloadRoot) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Asks the machine what it is. POSIX first; a cmd.exe host answers that with an error, which
 * parses as "not a machine I recognize", and the Windows form is tried next. Two round trips
 * at worst, once per connect.
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
  | { kind: "installed"; output: string; identity: RemoteIdentity }
  | { kind: "failed"; step: string; detail: string };

/**
 * Pushes and installs. Steps are sequential and each failure stops the run with the far
 * side's own message; the scratch directory is removed on the way out either way, since a
 * leftover image in someone's temp directory is litter we created.
 */
export async function installOnRemote(opts: {
  target: RemoteTarget;
  image: PayloadImage;
  /** Where verified Node runtimes are kept between installs (under the data root). */
  runtimeCacheDir: string;
  fetchBuffer?: (url: string) => Promise<Buffer>;
  onProgress?: (line: string) => void;
  /** Identity from an earlier probe in the same flow, to save the round trips. */
  identity?: RemoteIdentity;
}): Promise<RemoteInstallOutcome> {
  const { target, image } = opts;
  const say = opts.onProgress ?? (() => {});
  const fetchBuffer =
    opts.fetchBuffer ??
    (async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    });

  let identity = opts.identity;
  if (identity === undefined) {
    say("Asking what that machine is…");
    const detected = await detectRemote(target);
    if ("error" in detected) return { kind: "failed", step: "connect", detail: detected.error };
    identity = detected.identity;
    say(`${identity.platform}-${identity.arch}.`);
  }

  if (identity.installedVersion !== null && identity.installedVersion === image.version) {
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
      fs.writeFileSync(packPath, image.pack());
      if (useRemoteNode) {
        say(`Using the Node ${identity.nodeVersion} already on that machine.`);
      } else {
        // A runtime that fails verification throws here — before anything has been sent,
        // which is the point: an unverified runtime must never reach someone else's machine.
        runtime = await ensureRuntimeArchive({
          platform: identity.platform,
          arch: identity.arch,
          cacheDir: opts.runtimeCacheDir,
          fetchBuffer,
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

    // The installer travels as text in this bundle; it becomes a file only to ride scp.
    const installerPath = path.join(localTmp, "remote-installer.cjs");
    fs.writeFileSync(installerPath, REMOTE_INSTALLER_SCRIPT);

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
        [packPath, jobPath, installerPath, ...(runtime ? [runtime.archivePath] : [])],
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
