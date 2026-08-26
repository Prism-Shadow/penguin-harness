/**
 * Installing THIS server's build onto another machine, from inside the server process —
 * platform code, so the whole capability travels by hot push (see ../hmr/README.md).
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
import zlib from "node:zlib";
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
import { readRemoteInstaller } from "./installer-script.js";
import { packDirectory, packFiles } from "./pack.js";
import type { PackFile } from "./pack.js";
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
 * The bin shim the assembled image ships as `lib/dist/penguin.js`. The pushed CLI bundle
 * is a LIBRARY — the compile entry is index.ts, which exports `cli()` and has no side
 * effects, so executing the bundle directly loads it and exits 0 having done nothing
 * (found the hard way: a remote install whose `penguin server` "started" silently). This
 * shim is the packaged `dist/penguin.js` bin (penguin.ts) in miniature: run cli(), report
 * the code.
 */
const CLI_BIN_SHIM = `// penguin bin shim (written by the machines image): the pushed CLI
// bundle beside this file is a library exporting cli(); this file is the bin the
// launchers exec.
import { cli } from "./cli.mjs";
cli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(\`\${err instanceof Error ? err.message : String(err)}\\n\`);
    process.exitCode = 1;
  });
`;

/**
 * The skill library's content directory on THIS machine. The bundle inlines the skills
 * CODE, but the library is markdown on disk, resolved relative to the running module —
 * which for the assembled image means `lib/skills` beside the bundle, so the files must
 * ride along. They are found here through the PROCESS ENTRY's resolver (argv[1] is the
 * real dist file sitting next to a real node_modules in every install shape — tarball,
 * desktop, dev checkout), never through this bundle's own location: a hot-pushed bundle
 * lives in the hmr store, where no packages resolve.
 */
function skillsContentRoot(argv1: string | undefined = process.argv[1]): string | null {
  if (!argv1) return null;
  // A plain upward walk, not require.resolve: the package's exports map carries only an
  // `import` condition, so both CJS resolution and a manifest-subpath lookup throw — and
  // any copy of the content directory is the right bytes anyway. The workspace arm
  // covers dev runs, where the entry sits in packages/* above a pnpm-workspace.yaml.
  let dir = path.dirname(path.resolve(argv1));
  for (;;) {
    const viaModules = path.join(dir, "node_modules", "@prismshadow", "penguin-skills", "skills");
    if (fs.existsSync(viaModules)) return viaModules;
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      const viaWorkspace = path.join(dir, "packages", "skills", "skills");
      if (fs.existsSync(viaWorkspace)) return viaWorkspace;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Every file under a directory as pack files below `prefix`, preserving modes. */
function packFilesUnder(root: string, prefix: string): PackFile[] {
  const out: PackFile[] = [];
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    out.push({ path: `${prefix}/${rel}`, data: fs.readFileSync(abs) });
  }
  return out;
}

/**
 * The image assembled from the data root's OWN hot-pushed version — the FIRST choice: it
 * is literally what this server runs. The pushed CLI bundle is a self-contained esbuild
 * artifact carrying the whole program (server, platform, seam), and the web artifact is
 * the dist the server serves from memory — so the bundle as `lib/dist/cli.mjs`, the bin
 * shim above as `lib/dist/penguin.js`, `lib/web/*` and a synthesized manifest (with
 * `"type": "module"` — both files are ESM, and without it Node re-parses the 10 MB bundle
 * per run) make a complete universal install with no node_modules tree at all.
 *
 * The version is minted from the two artifacts' content shas (`0.0.0-hmr.<cli>.<web>`):
 * the remote's installed manifest then equals ours exactly when it runs this pushed
 * version, and the existing "different → replace" decision keeps remotes in step with
 * every new push.
 */
export function hmrPayloadImage(dataRoot: string): PayloadImage | null {
  try {
    const hmrDir = path.join(dataRoot, "hmr");
    const manifest = JSON.parse(fs.readFileSync(path.join(hmrDir, "harness.json"), "utf8")) as {
      cli?: { bundle?: string };
      web?: { manifest?: string };
    };
    if (typeof manifest.cli?.bundle !== "string" || typeof manifest.web?.manifest !== "string") {
      return null;
    }
    const cliPath = path.join(hmrDir, manifest.cli.bundle);
    const webzPath = path.join(hmrDir, manifest.web.manifest);
    if (!fs.existsSync(cliPath) || !fs.existsSync(webzPath)) return null;
    const sha = (p: string) => path.basename(p).split(".")[0]!.slice(0, 12);
    const version = `0.0.0-hmr.${sha(cliPath)}.${sha(webzPath)}`;
    return {
      version,
      pack: () => {
        const files: PackFile[] = [
          { path: "penguin/lib/dist/cli.mjs", data: fs.readFileSync(cliPath) },
          { path: "penguin/lib/dist/penguin.js", data: Buffer.from(CLI_BIN_SHIM) },
          {
            path: "penguin/lib/package.json",
            data: Buffer.from(
              JSON.stringify({ name: "@prismshadow/penguin-cli", version, type: "module" }) + "\n",
            ),
          },
        ];
        // The web artifact is gzip(JSON.stringify({ files: { relPath: base64 } })) — the
        // same bytes the push carried and the server serves from memory.
        const webz = JSON.parse(zlib.gunzipSync(fs.readFileSync(webzPath)).toString("utf8")) as {
          files: Record<string, string>;
        };
        for (const [rel, base64] of Object.entries(webz.files)) {
          files.push({ path: `penguin/lib/web/${rel}`, data: Buffer.from(base64, "base64") });
        }
        // The skill library: content the bundle reads from `lib/skills` beside itself.
        const skills = skillsContentRoot();
        if (skills !== null) files.push(...packFilesUnder(skills, "penguin/lib/skills"));
        return packFiles(files);
      },
    };
  } catch {
    return null; // No pushes yet, or a damaged store: the disk shapes below take over.
  }
}

/**
 * Finds the install image around the running server. Three real shapes, probed in order:
 *
 * 1. **The hot-pushed version** (hmrPayloadImage above) — what this server actually runs.
 * 2. **Tarball install** — the CLI entry is `<root>/lib/dist/penguin.js` and `<root>` is the
 *    program directory itself; pack it under a `penguin/` prefix, leaving out `lib/runtime`
 *    (this machine's Node must not ride along in a universal image) and `bin` (the installer
 *    writes fresh launchers).
 * 3. **Desktop app** — the server entry is
 *    `<resources>/app/node_modules/@prismshadow/penguin-server/dist/index.js` and the staged
 *    universal image sits beside it at `<resources>/payload/penguin`.
 *
 * Only a dev checkout that has never been pushed to has none of the three.
 */
export function resolvePayloadImage(
  dataRoot: string | null,
  argv1: string | undefined = process.argv[1],
): PayloadImage | null {
  if (dataRoot !== null) {
    const pushed = hmrPayloadImage(dataRoot);
    if (pushed !== null) return pushed;
  }
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

    // The installer is a file on this side too (an asset beside the bundle, or the sibling
    // in a packaged install); it is copied out only to ride scp.
    const installerPath = path.join(localTmp, "remote-installer.cjs");
    try {
      fs.writeFileSync(installerPath, readRemoteInstaller(opts.assets));
    } catch (err) {
      return {
        kind: "failed",
        step: "prepare the installer",
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
