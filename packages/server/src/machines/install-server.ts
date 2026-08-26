/**
 * Installing THIS server's build onto another machine, from inside the server process —
 * platform code, so the whole capability travels by hot push (see ../hmr/README.md).
 *
 * Every image is a directory the standard tooling produced — the one deploy.mjs built and
 * pushed among this version's assets, a tarball install's own tree, or the desktop app's
 * staged payload — packed straight from disk and version-stamped by its own lib/package.json.
 * Nothing installable is synthesized here.
 *
 * Nothing here assumes anything about the far side except an sshd and, for three commands, a
 * shell of some kind. The installer that does the real work is the ORDINARY one — install.sh
 * on POSIX, install.ps1 on Windows, the same files a release ships — run in its offline mode
 * against a payload we assemble to exactly the release shape: `penguin/{bin,lib,web,node?}`
 * plus a manifest stamped with the remote's own target. Staging, smoke test, swap, rollback,
 * the legacy-layout migration and the PATH plumbing are therefore one implementation, not two.
 *
 * The remote is left with exactly what a local install leaves: the program directory
 * (`~/.local/share/penguin`, `%LOCALAPPDATA%\penguin`) and, on POSIX, the `~/.local/bin/penguin`
 * symlink. No sudo, no service units, no profile edits, and the data directory is untouched.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { filesFromDirectory, tarGzBytes, zipBytes, zipExtract } from "./archive.js";
import type { PackFile } from "./archive.js";
import {
  cleanupCommand,
  makeScratchCommand,
  runInstallScriptCommand,
  scpArgs,
  sshArgs,
} from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { parseProbeOutput, POSIX_PROBE, WINDOWS_PROBE } from "./detect.js";
import type { RemoteIdentity, RemotePlatform } from "./detect.js";
import { looksLikeAuthFailure, run } from "./exec.js";
import { posixLauncher, windowsLauncher } from "./launcher.cjs";
import { ensureRuntimeArchive, remoteNodeIsUsable, sha256Of } from "./runtime.js";

/**
 * Where this running server's pushable image is, and how to pack it. `version` is read from
 * the image's own lib/package.json — the thing actually sent, not what any package here
 * believes about itself.
 */
export interface PayloadImage {
  version: string;
  /**
   * The image's own files, `penguin/…`-prefixed — WITHOUT `bin/`, `node/` or a manifest.
   * Those three depend on the remote (its node version decides the launcher flags, its
   * platform the target stamp), so the push assembles them per install.
   */
  files: () => PackFile[];
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

/** Which installer runs the far side of a push; also the asset keys deploy.mjs pushes. */
const installerFileFor = (platform: RemotePlatform): string =>
  platform === "win32" ? "install.ps1" : "install.sh";

/**
 * The node binary (and its LICENSE) out of a verified runtime archive, as payload files under
 * `penguin/node/` — where every launcher looks for a bundled runtime. Only the binary
 * travels: npm serves no purpose inside a program directory that exists to run penguin, and
 * the nodejs.org archives reach it through symlinks a re-pack could not carry anyway.
 *
 * POSIX archives are opened with the system tar (always present where a server runs); the
 * win-x64 zip with the reader in archive.ts, because GNU tar cannot open zips.
 */
function runtimeNodeFiles(
  archivePath: string,
  rootDirName: string,
  platform: RemotePlatform,
  tmpDir: string,
): PackFile[] {
  if (platform === "win32") {
    const archive = fs.readFileSync(archivePath);
    const exe = zipExtract(archive, `${rootDirName}/node.exe`);
    if (exe === null) throw new Error(`no node.exe in ${path.basename(archivePath)}`);
    const license = zipExtract(archive, `${rootDirName}/LICENSE`);
    return [
      { path: "penguin/node/node.exe", data: exe },
      ...(license === null ? [] : [{ path: "penguin/node/LICENSE", data: license }]),
    ];
  }
  execFileSync("tar", ["-xzf", archivePath, "-C", tmpDir, `${rootDirName}/bin/node`]);
  const files: PackFile[] = [
    {
      path: "penguin/node/bin/node",
      data: fs.readFileSync(path.join(tmpDir, rootDirName, "bin", "node")),
      mode: 0o755,
    },
  ];
  try {
    execFileSync("tar", ["-xzf", archivePath, "-C", tmpDir, `${rootDirName}/LICENSE`]);
    files.push({
      path: "penguin/node/LICENSE",
      data: fs.readFileSync(path.join(tmpDir, rootDirName, "LICENSE")),
    });
  } catch {
    // No LICENSE member: nothing rides.
  }
  return files;
}

/**
 * The image a hot push delivered — the FIRST choice. deploy.mjs builds it with the standard
 * install-image pipeline (the same `pnpm deploy` tree a release or the desktop app stages),
 * stamps its lib/package.json with a content-derived `0.0.0-hmr.<sha>` version, and pushes it
 * among the version's assets; it materializes under the assets dir as real files. Nothing is
 * synthesized here: this function just reads the directory the standard tooling produced.
 *
 * The version is the stamp: a re-push of the same tree yields the same sha, so the existing
 * "same → skip, different → replace" decision keeps remotes in step with every push.
 */
export function pushedPayloadImage(assetsDir: string | null): PayloadImage | null {
  if (assetsDir === null) return null;
  const root = path.join(assetsDir, "install-image", "penguin");
  const version = versionOfManifest(path.join(root, "lib", "package.json"));
  if (version === null) return null;
  return {
    version,
    files: () =>
      filesFromDirectory(root, {
        prefix: "penguin",
        exclude: ["node", "bin", "package-manifest.json"],
      }),
  };
}

/**
 * Finds the install image around the running server. Three real shapes, probed in order:
 *
 * 1. **The hot-pushed image** (pushedPayloadImage above) — built and stamped by deploy.mjs.
 * 2. **Tarball install** — the CLI entry is `<root>/lib/dist/penguin.js` and `<root>` is the
 *    program directory itself; pack it under a `penguin/` prefix, leaving out `node` (this
 *    machine's Node must not ride along — the far side gets a build for ITS platform), `bin`
 *    (the push writes launchers for the remote) and the manifest (stamped per remote).
 * 3. **Desktop app** — the server entry is
 *    `<resources>/app/node_modules/@prismshadow/penguin-server/dist/index.js` and the staged
 *    universal image sits beside it at `<resources>/payload/penguin`.
 *
 * Only a dev checkout that has never been pushed to has none of the three.
 */
export function resolvePayloadImage(
  /** The hmr capability's assetsDir accessor; null in a packaged server that was never pushed to. */
  assets: () => string | null,
  argv1: string | undefined = process.argv[1],
): PayloadImage | null {
  const pushed = pushedPayloadImage(assets());
  if (pushed !== null) return pushed;
  if (!argv1) return null;

  // Tarball shape: <root>/lib/dist/<entry>.js
  const libDir = path.dirname(path.dirname(argv1));
  const root = path.dirname(libDir);
  if (path.basename(libDir) === "lib" && path.basename(path.dirname(argv1)) === "dist") {
    const version = versionOfManifest(path.join(libDir, "package.json"));
    if (version !== null) {
      return {
        version,
        files: () =>
          filesFromDirectory(root, {
            prefix: "penguin",
            exclude: ["node", "bin", "package-manifest.json"],
          }),
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
      return {
        version,
        files: () =>
          filesFromDirectory(payloadRoot, {
            exclude: ["penguin/node", "penguin/bin", "penguin/package-manifest.json"],
          }),
      };
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
  /** The hmr capability's assetsDir accessor: where a pushed bundle's assets were unpacked. */
  assets?: () => string | null;
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
    /**
     * A remote with a new enough Node of its own keeps it: no download, no ~30 MB on the
     * wire, and no second runtime installed on a machine that already has one. Only a
     * machine with no node, or one too old to run the program, gets one baked in.
     */
    const useRemoteNode = remoteNodeIsUsable(identity.nodeVersion);
    let runtimeFiles: PackFile[] = [];
    if (useRemoteNode) {
      say(`Using the Node ${identity.nodeVersion} already on that machine.`);
    } else {
      try {
        // A runtime that fails verification throws here — before anything has been sent,
        // which is the point: an unverified runtime must never reach someone else's machine.
        const runtime = await ensureRuntimeArchive({
          platform: identity.platform,
          arch: identity.arch,
          cacheDir: opts.runtimeCacheDir,
          fetchBuffer,
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        });
        runtimeFiles = runtimeNodeFiles(
          runtime.archivePath,
          runtime.artifact.rootDirName,
          identity.platform,
          localTmp,
        );
      } catch (err) {
        return {
          kind: "failed",
          step: "prepare the runtime",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    say("Packing this build…");
    // On 22 and 23 the server's node:sqlite sits behind this flag; a baked runtime is the
    // pinned v24 build and needs none. Rides the launchers' system-node branch only.
    const nodeMajor = Number(/^v?(\d+)\./.exec(identity.nodeVersion ?? "")?.[1]);
    const nodeFlags =
      useRemoteNode && Number.isFinite(nodeMajor) && nodeMajor < 24
        ? ["--experimental-sqlite"]
        : [];
    // The release shape, completed per remote: launchers with the flags this machine needs,
    // a manifest stamped with ITS target (which is what its own uname check accepts —
    // install.ps1 knows only win32-x64, so an arm64 Windows host gets that label with an
    // arm64 node.exe inside), and the runtime when one travels.
    const payloadFiles: PackFile[] = [
      ...image.files(),
      { path: "penguin/bin/penguin", data: Buffer.from(posixLauncher(nodeFlags)), mode: 0o755 },
      { path: "penguin/bin/penguin.cmd", data: Buffer.from(windowsLauncher(nodeFlags)) },
      {
        path: "penguin/package-manifest.json",
        data: Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            target:
              identity.platform === "win32" ? "win32-x64" : `${identity.platform}-${identity.arch}`,
          }) + "\n",
        ),
      },
      ...runtimeFiles,
    ];
    const payloadName = identity.platform === "win32" ? "payload.zip" : "payload.tar.gz";
    const payloadPath = path.join(localTmp, payloadName);
    const payload =
      identity.platform === "win32" ? zipBytes(payloadFiles) : tarGzBytes(payloadFiles);
    fs.writeFileSync(payloadPath, payload);
    // The adjacent checksum the installers' offline mode requires (sha256sum format).
    const shaPath = `${payloadPath}.sha256`;
    fs.writeFileSync(shaPath, `${sha256Of(payload)}  ${payloadName}\n`);

    // The ordinary installer, copied out to ride scp. Where it sits follows from what this
    // server is: a hot-pushed bundle has it among the assets published with that same version,
    // anything else is a packaged install and it is beside this module (dist/ after a build,
    // which is why packages/server/scripts/copy-machine-assets.mjs puts it there).
    const installerFile = installerFileFor(identity.platform);
    const installerHome = opts.assets?.() ?? path.dirname(fileURLToPath(import.meta.url));
    const installerPath = path.join(localTmp, installerFile);
    try {
      fs.copyFileSync(path.join(installerHome, installerFile), installerPath);
    } catch (err) {
      return {
        kind: "failed",
        step: "prepare the installer",
        detail: err instanceof Error ? err.message : String(err),
      };
    }

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

    say("Copying the build…");
    const copy = await run("scp", scpArgs(target, [payloadPath, shaPath, installerPath], scratch));
    if (copy.code !== 0) {
      return { kind: "failed", step: "copy", detail: copy.stderr.trim() || "scp failed" };
    }

    say("Installing…");
    const install = await run(
      "ssh",
      sshArgs(target, runInstallScriptCommand(identity.platform, scratch)),
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
