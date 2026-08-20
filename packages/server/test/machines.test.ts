/**
 * The pure half of the machines capability (platform code — see ../src/hmr/README.md):
 * reading ~/.ssh/config and `ssh -G`, reading what the identity probe answered, choosing
 * the Node runtime to send, the container the image travels in, finding the running
 * server's own pushable image, and the exact ssh/scp commands all of that turns into.
 * No network, no ssh binary.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { machineIdentity, parseHostAliases, parseSshSettings } from "../src/machines/ssh-config.js";
import { parseProbeOutput, POSIX_PROBE, WINDOWS_PROBE } from "../src/machines/detect.js";
import {
  checksumFor,
  ensureRuntimeArchive,
  MIN_REMOTE_NODE_MAJOR,
  NODE_RUNTIME_VERSION,
  remoteNodeIsUsable,
  runtimeArtifact,
  sha256Of,
} from "../src/machines/runtime.js";
import { packDirectory, unpackTo } from "../src/machines/pack.js";
import {
  cleanupCommand,
  cmdQuote,
  extractRuntimeCommand,
  makeScratchCommand,
  runInstallerCommand,
  scpArgs,
  shQuote,
  sshArgs,
} from "../src/machines/commands.js";
import { resolvePayloadImage } from "../src/machines/install-server.js";

describe("parseHostAliases", () => {
  const noIncludes = () => [];

  it("lists declared aliases in file order, expanding multi-alias blocks", () => {
    const aliases = parseHostAliases(
      ["Host build-box", "  HostName 10.0.0.4", "", "Host gpu-1 gpu-1.lan", "  User root"].join(
        "\n",
      ),
      noIncludes,
    );
    expect(aliases).toEqual(["build-box", "gpu-1", "gpu-1.lan"]);
  });

  it("skips pattern entries — they configure other hosts rather than naming one", () => {
    const aliases = parseHostAliases(
      ["Host *", "  ServerAliveInterval 30", "Host !prod *.lan", "Host real"].join("\n"),
      noIncludes,
    );
    expect(aliases).toEqual(["real"]);
  });

  it("ignores comments and blank lines, and is case-insensitive like ssh", () => {
    expect(parseHostAliases("# Host commented\n\nhost lower\nHOST upper", noIncludes)).toEqual([
      "lower",
      "upper",
    ]);
  });

  it("follows Include through the supplied reader and de-duplicates the result", () => {
    const files: Record<string, string> = {
      "work/*": "Host build-box\nHost shared",
      personal: "Host shared\nHost nas",
    };
    const aliases = parseHostAliases(
      ["Include work/*", "Host laptop", "Include personal"].join("\n"),
      (pattern) => (files[pattern] === undefined ? [] : [files[pattern]]),
    );
    expect(aliases).toEqual(["build-box", "shared", "laptop", "nas"]);
  });

  it("survives an include cycle instead of spinning", () => {
    const aliases = parseHostAliases("Include self\nHost top", () => ["Include self\nHost deep"]);
    expect(aliases).toContain("top");
    expect(aliases).toContain("deep");
  });
});

describe("parseSshSettings", () => {
  it("reads what ssh resolved, keeping every identityfile", () => {
    const settings = parseSshSettings(
      [
        "user deploy",
        "hostname 10.0.0.4",
        "port 2222",
        "identityfile ~/.ssh/id_ed25519",
        "identityfile ~/.ssh/id_rsa",
        "proxyjump bastion",
      ].join("\n"),
      "build-box",
    );
    expect(settings).toEqual({
      user: "deploy",
      hostname: "10.0.0.4",
      port: 2222,
      identityFiles: ["~/.ssh/id_ed25519", "~/.ssh/id_rsa"],
      proxyJump: "bastion",
    });
  });

  it("falls back to ssh's own defaults rather than throwing on a config it cannot read", () => {
    const settings = parseSshSettings("garbage\nport not-a-number\nproxyjump none", "gpu-1");
    expect(settings.hostname).toBe("gpu-1"); // the alias stands in
    expect(settings.port).toBe(22);
    expect(settings.user).toBe("");
    expect(settings.proxyJump).toBeNull();
  });
});

describe("machineIdentity", () => {
  it("is <user>@<alias>: the Linux account is part of the machine, the alias is the name", () => {
    // Two accounts on one host are two machines — each has its own ~/.penguin, hence its
    // own server and its own user table.
    expect(machineIdentity("build-box", "deploy")).toBe("deploy@build-box");
    expect(machineIdentity("build-box", "root")).toBe("root@build-box");
    expect(machineIdentity("build-box", "")).toBe("build-box");
  });
});

describe("identity probe", () => {
  it("asks in each shell's own dialect — sh cannot read the Windows one and vice versa", () => {
    // POSIX: `;` chains, $VAR expands, `cat` reads. Windows cmd: `&` chains, %VAR% expands,
    // `type` reads. One command cannot do both, which is why there are two.
    expect(POSIX_PROBE).toContain("uname -s -m");
    expect(POSIX_PROBE).toContain("${XDG_DATA_HOME:-$HOME/.local/share}");
    expect(WINDOWS_PROBE).toContain("%PROCESSOR_ARCHITECTURE%");
    expect(WINDOWS_PROBE).toContain("%LOCALAPPDATA%");
    expect(WINDOWS_PROBE).not.toContain(";");
  });

  it("reads a POSIX answer: identity, the machine's own node, and the installed version", () => {
    expect(
      parseProbeOutput('Linux x86_64\nv24.3.0\n---penguin---\n{"name":"x","version":"0.2.2"}\n'),
    ).toEqual({
      platform: "linux",
      arch: "x64",
      nodeVersion: "v24.3.0",
      installedVersion: "0.2.2",
    });
  });

  it("a machine with no node answers 'none', which reads as no node at all", () => {
    expect(parseProbeOutput("Linux x86_64\nnone\n---penguin---\n")).toMatchObject({
      nodeVersion: null,
    });
  });

  it("finds the identity past a shell banner instead of trusting the first line", () => {
    expect(
      parseProbeOutput("Welcome to build-box!\nLinux x86_64\nv24.3.0\n---penguin---\n"),
    ).toMatchObject({ platform: "linux", arch: "x64", nodeVersion: "v24.3.0" });
  });

  it("reads a Windows answer and normalizes its names onto Node's", () => {
    expect(parseProbeOutput("Windows_NT AMD64\nnone\n---penguin---\n")).toEqual({
      platform: "win32",
      arch: "x64",
      nodeVersion: null,
      installedVersion: null,
    });
    expect(parseProbeOutput("Darwin arm64\nnone\n---penguin---\n")).toMatchObject({
      platform: "darwin",
      arch: "arm64",
    });
    expect(parseProbeOutput("Linux aarch64\nnone\n---penguin---\n")).toMatchObject({
      arch: "arm64",
    });
  });

  it("returns null when the shell did not understand the probe", () => {
    // What cmd.exe says to the POSIX probe — the signal to try the other dialect.
    expect(
      parseProbeOutput("'uname' is not recognized as an internal or external command"),
    ).toBeNull();
    expect(parseProbeOutput("")).toBeNull();
  });

  it("treats an unreadable manifest as 'nothing installed' rather than failing", () => {
    expect(parseProbeOutput("Linux x86_64\nnone\n---penguin---\nnot json at all")).toMatchObject({
      installedVersion: null,
    });
  });
});

describe("runtime selection", () => {
  it("skips the whole download when the remote's own node is new enough", () => {
    // The common case for a developer box: no 30 MB transfer, and no second runtime
    // installed on a machine that already has one.
    expect(MIN_REMOTE_NODE_MAJOR).toBe(22);
    expect(remoteNodeIsUsable("v22.11.0")).toBe(true);
    expect(remoteNodeIsUsable("v24.3.0")).toBe(true);
    expect(remoteNodeIsUsable("v20.11.0")).toBe(false);
    expect(remoteNodeIsUsable(null)).toBe(false);
    expect(remoteNodeIsUsable("not a version")).toBe(false);
  });

  it("picks the official build for the remote's shape, gzip on POSIX and zip on Windows", () => {
    // .tar.gz rather than the smaller .tar.xz: xz is a separate binary minimal images lack,
    // and the far side has no runtime of ours yet to fall back on.
    expect(runtimeArtifact("linux", "x64")).toMatchObject({
      fileName: `node-${NODE_RUNTIME_VERSION}-linux-x64.tar.gz`,
      rootDirName: `node-${NODE_RUNTIME_VERSION}-linux-x64`,
      url: `https://nodejs.org/dist/${NODE_RUNTIME_VERSION}/node-${NODE_RUNTIME_VERSION}-linux-x64.tar.gz`,
    });
    expect(runtimeArtifact("darwin", "arm64").fileName).toBe(
      `node-${NODE_RUNTIME_VERSION}-darwin-arm64.tar.gz`,
    );
    expect(runtimeArtifact("win32", "x64").fileName).toBe(
      `node-${NODE_RUNTIME_VERSION}-win-x64.zip`,
    );
  });

  it("reads the published checksum for exactly the file it is going to send", () => {
    const shasums = [
      `${"a".repeat(64)}  node-${NODE_RUNTIME_VERSION}-linux-arm64.tar.gz`,
      `${"b".repeat(64)}  node-${NODE_RUNTIME_VERSION}-linux-x64.tar.gz`,
    ].join("\n");
    expect(checksumFor(shasums, `node-${NODE_RUNTIME_VERSION}-linux-x64.tar.gz`)).toBe(
      "b".repeat(64),
    );
    expect(checksumFor(shasums, "node-v1.0.0-linux-x64.tar.gz")).toBeNull();
  });

  it("verifies what it downloads and refuses to cache a runtime it cannot vouch for", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-runtime-cache-"));
    try {
      const artifact = runtimeArtifact("linux", "x64");
      const good = Buffer.from("pretend runtime");
      const shasums = Buffer.from(`${sha256Of(good)}  ${artifact.fileName}\n`);
      const tampering = async (url: string) =>
        url.endsWith("SHASUMS256.txt") ? shasums : Buffer.from("tampered");
      await expect(
        ensureRuntimeArchive({ platform: "linux", arch: "x64", cacheDir, fetchBuffer: tampering }),
      ).rejects.toThrow(/checksum mismatch/);
      expect(fs.existsSync(path.join(cacheDir, artifact.fileName))).toBe(false);

      // The honest download lands, and a second call serves it from the cache without fetching.
      let fetches = 0;
      const honest = async (url: string) => {
        fetches += 1;
        return url.endsWith("SHASUMS256.txt") ? shasums : good;
      };
      const first = await ensureRuntimeArchive({
        platform: "linux",
        arch: "x64",
        cacheDir,
        fetchBuffer: honest,
      });
      expect(fs.readFileSync(first.archivePath)).toEqual(good);
      const before = fetches;
      await ensureRuntimeArchive({ platform: "linux", arch: "x64", cacheDir, fetchBuffer: honest });
      expect(fetches).toBe(before);
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe("the image container", () => {
  it("round-trips a tree, keeping relative paths and the executable bit", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-pack-"));
    try {
      const src = path.join(work, "src");
      fs.mkdirSync(path.join(src, "penguin", "bin"), { recursive: true });
      fs.mkdirSync(path.join(src, "penguin", "lib", "web"), { recursive: true });
      fs.writeFileSync(path.join(src, "penguin", "bin", "penguin"), "#!/bin/sh\n", { mode: 0o755 });
      fs.writeFileSync(path.join(src, "penguin", "lib", "web", "index.html"), "<html>");

      const dest = path.join(work, "dest");
      const entries = unpackTo(packDirectory(src), dest);

      expect(entries.map((e) => e.path)).toEqual([
        "penguin/bin/penguin",
        "penguin/lib/web/index.html",
      ]);
      expect(fs.readFileSync(path.join(dest, "penguin", "lib", "web", "index.html"), "utf8")).toBe(
        "<html>",
      );
      if (process.platform !== "win32") {
        expect(fs.statSync(path.join(dest, "penguin", "bin", "penguin")).mode & 0o111).not.toBe(0);
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("ssh / scp invocations", () => {
  const target = { alias: "build-box", user: "deploy" };

  it("never lets ssh prompt: a GUI has no terminal to type a password into", () => {
    const args = sshArgs(target, "uname -a");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ConnectTimeout=10");
    expect(scpArgs(target, ["/tmp/a"], "/tmp/dir")).toContain("BatchMode=yes");
  });

  it("selects the account on the command line, never by writing the ssh config", () => {
    expect(sshArgs(target, "true")).toContain("User=deploy");
    expect(sshArgs({ alias: "build-box", user: "" }, "true").join(" ")).not.toContain("User=");
  });

  it("leaves the scp destination unquoted — modern scp transfers over SFTP, taking it literally", () => {
    const args = scpArgs(target, ["/local/image.pack"], "/tmp/penguin-abc123");
    expect(args.at(-1)).toBe("build-box:/tmp/penguin-abc123");
  });

  it("quotes per shell: single quotes for sh, double for cmd.exe", () => {
    expect(shQuote("/tmp/it's here")).toBe(`'/tmp/it'\\''s here'`);
    expect(cmdQuote("C:\\Users\\First Last\\tmp")).toBe('"C:\\Users\\First Last\\tmp"');
    // cmd.exe has no escape for a quote inside a quoted string: refuse rather than mangle.
    expect(() => cmdQuote('C:\\weird"path')).toThrow();
  });

  it("creates the scratch directory the way each shell can", () => {
    expect(makeScratchCommand("linux", "penguin-abc")).toContain("mktemp -d");
    const windows = makeScratchCommand("win32", "penguin-abc");
    expect(windows).toContain('mkdir "%TEMP%\\penguin-abc"');
    expect(windows).toContain("&"); // cmd chains with &, not ;
  });

  it("unpacks the runtime with tar on both sides — bsdtar reads the Windows zip", () => {
    expect(extractRuntimeCommand("linux", "/tmp/s/node.tar.gz", "/tmp/s")).toBe(
      "tar -xf '/tmp/s/node.tar.gz' -C '/tmp/s'",
    );
    expect(extractRuntimeCommand("win32", "C:\\t\\node.zip", "C:\\t")).toBe(
      'tar -xf "C:\\t\\node.zip" -C "C:\\t"',
    );
  });

  it("starts the installer on the runtime it just unpacked, with no arguments to quote", () => {
    // The installer reads job.json from its own directory instead of taking parameters.
    expect(runInstallerCommand("linux", "/tmp/s", "node-v24.18.0-linux-x64")).toBe(
      "'/tmp/s/node-v24.18.0-linux-x64/bin/node' '/tmp/s/remote-installer.cjs'",
    );
    expect(runInstallerCommand("win32", "C:\\t", "node-v24.18.0-win-x64")).toBe(
      '"C:\\t\\node-v24.18.0-win-x64\\node.exe" "C:\\t\\remote-installer.cjs"',
    );
  });

  it("uses the remote's own node when no runtime was sent", () => {
    expect(runInstallerCommand("linux", "/tmp/s", null)).toBe("node '/tmp/s/remote-installer.cjs'");
    expect(runInstallerCommand("win32", "C:\\t", null)).toBe('node "C:\\t\\remote-installer.cjs"');
  });

  it("cleans up with each platform's own command", () => {
    expect(cleanupCommand("linux", "/tmp/s")).toBe("rm -rf '/tmp/s'");
    expect(cleanupCommand("win32", "C:\\t")).toBe('rmdir /s /q "C:\\t"');
  });
});

describe("resolvePayloadImage", () => {
  const manifest = JSON.stringify({ name: "@prismshadow/penguin-cli", version: "9.9.9" });

  it("tarball install: packs its own program directory, without runtime or launchers", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-image-"));
    try {
      const root = path.join(work, "penguin");
      fs.mkdirSync(path.join(root, "lib", "dist"), { recursive: true });
      fs.mkdirSync(path.join(root, "lib", "runtime", "bin"), { recursive: true });
      fs.mkdirSync(path.join(root, "bin"), { recursive: true });
      fs.writeFileSync(path.join(root, "lib", "dist", "penguin.js"), "//\n");
      fs.writeFileSync(path.join(root, "lib", "package.json"), manifest);
      fs.writeFileSync(path.join(root, "lib", "runtime", "bin", "node"), "elf");
      fs.writeFileSync(path.join(root, "bin", "penguin"), "#!/bin/sh\n");

      const image = resolvePayloadImage(null, path.join(root, "lib", "dist", "penguin.js"));
      expect(image?.version).toBe("9.9.9");
      const dest = path.join(work, "unpacked");
      const entries = unpackTo(image!.pack(), dest).map((entry) => entry.path);
      expect(entries).toContain("penguin/lib/dist/penguin.js");
      expect(entries).toContain("penguin/lib/package.json");
      // This machine's Node and the old launchers must not ride in a universal image.
      expect(entries.some((p) => p.startsWith("penguin/lib/runtime/"))).toBe(false);
      expect(entries.some((p) => p.startsWith("penguin/bin/"))).toBe(false);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("desktop app: the staged payload beside the app resources", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-image-"));
    try {
      const serverDist = path.join(
        work,
        "resources",
        "app",
        "node_modules",
        "@prismshadow",
        "penguin-server",
        "dist",
      );
      fs.mkdirSync(serverDist, { recursive: true });
      const payload = path.join(work, "resources", "payload", "penguin", "lib");
      fs.mkdirSync(path.join(payload, "dist"), { recursive: true });
      fs.writeFileSync(path.join(payload, "dist", "penguin.js"), "//\n");
      fs.writeFileSync(path.join(payload, "package.json"), manifest);

      const image = resolvePayloadImage(null, path.join(serverDist, "index.js"));
      expect(image?.version).toBe("9.9.9");
      const dest = path.join(work, "unpacked");
      const entries = unpackTo(image!.pack(), dest).map((entry) => entry.path);
      expect(entries).toContain("penguin/lib/dist/penguin.js");
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("a dev checkout has no pushable image", () => {
    expect(resolvePayloadImage(null, "/repo/packages/server/src/index.ts")).toBeNull();
    expect(resolvePayloadImage(null, undefined)).toBeNull();
  });
});

describe("hmrPayloadImage", () => {
  const seedStore = (work: string) => {
    const hmrDir = path.join(work, "hmr");
    fs.mkdirSync(path.join(hmrDir, "store", "cli"), { recursive: true });
    fs.mkdirSync(path.join(hmrDir, "store", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(hmrDir, "store", "cli", "cafe0123456789ab.mjs"),
      "console.log('penguin');\n",
    );
    fs.writeFileSync(
      path.join(hmrDir, "store", "web", "beef0123456789ab.webz"),
      zlib.gzipSync(
        Buffer.from(
          JSON.stringify({
            files: { "index.html": Buffer.from("<html>").toString("base64") },
          }),
        ),
      ),
    );
    fs.writeFileSync(
      path.join(hmrDir, "harness.json"),
      JSON.stringify({
        platform: { bundle: "store/platform/x.mjs", park: "store/platform/x.park.json" },
        cli: { bundle: "store/cli/cafe0123456789ab.mjs" },
        web: { manifest: "store/web/beef0123456789ab.webz" },
      }),
    );
  };

  it("assembles a complete image from the pushed version, sha-stamped", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-hmr-image-"));
    // The skill library resolves through the PROCESS ENTRY's resolver; under vitest
    // argv[1] is the test runner, which resolves nothing — stand in a file of this
    // package, the same resolution context every real entry shape has.
    const originalArgv1 = process.argv[1];
    process.argv[1] = new URL(import.meta.url).pathname;
    try {
      seedStore(work);
      const image = resolvePayloadImage(work, "/repo/packages/server/src/index.ts");
      expect(image?.version).toBe("0.0.0-hmr.cafe01234567.beef01234567");
      const dest = path.join(work, "unpacked");
      const entries = unpackTo(image!.pack(), dest).map((entry) => entry.path);
      // The pushed bundle is a LIBRARY (it exports cli() and does nothing when executed),
      // so the image carries it as cli.mjs and ships a bin shim as the entry.
      expect(entries).toContain("penguin/lib/dist/cli.mjs");
      expect(entries).toContain("penguin/lib/dist/penguin.js");
      expect(entries).toContain("penguin/lib/package.json");
      expect(entries).toContain("penguin/lib/web/index.html");
      // The skill library rides along: the bundle reads it from lib/skills beside itself.
      expect(entries.some((e) => /^penguin\/lib\/skills\/.+\/SKILL\.md$/.test(e))).toBe(true);
      expect(
        fs.readFileSync(path.join(dest, "penguin", "lib", "dist", "penguin.js"), "utf8"),
      ).toContain('import { cli } from "./cli.mjs"');
      expect(fs.readFileSync(path.join(dest, "penguin", "lib", "web", "index.html"), "utf8")).toBe(
        "<html>",
      );
      const manifest = JSON.parse(
        fs.readFileSync(path.join(dest, "penguin", "lib", "package.json"), "utf8"),
      ) as { version: string; type?: string };
      expect(manifest.version).toBe(image!.version);
      // ESM on both files, and no per-run re-parse of a 10 MB bundle.
      expect(manifest.type).toBe("module");
    } finally {
      if (originalArgv1 !== undefined) process.argv[1] = originalArgv1;
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("outranks the disk shapes — the pushed version is what this server runs", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-hmr-image-"));
    try {
      seedStore(work);
      // A valid tarball shape is offered too; the pushed version still wins.
      const root = path.join(work, "penguin");
      fs.mkdirSync(path.join(root, "lib", "dist"), { recursive: true });
      fs.writeFileSync(path.join(root, "lib", "dist", "penguin.js"), "//\n");
      fs.writeFileSync(
        path.join(root, "lib", "package.json"),
        JSON.stringify({ name: "@prismshadow/penguin-cli", version: "9.9.9" }),
      );
      const image = resolvePayloadImage(work, path.join(root, "lib", "dist", "penguin.js"));
      expect(image?.version).toBe("0.0.0-hmr.cafe01234567.beef01234567");
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("a root without pushes answers null and the disk shapes take over", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-hmr-image-"));
    try {
      expect(resolvePayloadImage(work, undefined)).toBeNull();
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
