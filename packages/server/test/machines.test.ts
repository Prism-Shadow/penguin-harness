/**
 * The pure half of the machines capability (platform code — see ../src/hmr/README.md):
 * reading ~/.ssh/config for its aliases, reading what the identity probe answered, choosing
 * the Node runtime to send, the container the image travels in, finding the running
 * server's own pushable image, and the exact ssh/scp commands all of that turns into.
 * No network, no ssh binary.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readPushedBuild } from "../src/machines/upgrade.js";
import { machineIdentity, parseHostAliases } from "../src/machines/ssh-config.js";
import {
  parseProbe,
  probeServerState,
  readServerStateCommand,
} from "../src/machines/server-state.js";
import { parseProbeOutput, POSIX_PROBE, WINDOWS_PROBE } from "../src/machines/detect.js";
import {
  cmdQuote,
  runInstallScriptCommand,
  unpackStoreCommand,
  scpArgs,
  shQuote,
  sshArgs,
  sessionArgs,
} from "../src/machines/commands.js";
import { refusalDetail } from "../src/machines/upgrade.js";
import { resolvePushPlan } from "../src/machines/install-server.js";

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

describe("machineIdentity", () => {
  it("is <user>@<alias>: the Linux account is part of the machine, the alias is the name", () => {
    expect(machineIdentity("build-box", "deploy")).toBe("deploy@build-box");
    expect(machineIdentity("build-box", "root")).toBe("root@build-box");
    expect(machineIdentity("build-box", "")).toBe("build-box");
  });
});

describe("identity probe", () => {
  it("asks in each shell's own dialect — sh cannot read the Windows one and vice versa", () => {
    expect(POSIX_PROBE).toContain("uname -s -m");
    expect(POSIX_PROBE).toContain('"$HOME/.penguin/lib/package.json"');
    expect(POSIX_PROBE).toContain(".penguin/data/hmr/harness.json");
    expect(WINDOWS_PROBE).toContain("%PROCESSOR_ARCHITECTURE%");
    expect(WINDOWS_PROBE).toContain("%USERPROFILE%\\.penguin\\lib\\package.json");
    expect(WINDOWS_PROBE).toContain("%USERPROFILE%\\.penguin\\data\\hmr\\harness.json");
    expect(WINDOWS_PROBE).not.toContain(";");
  });

  it("reads identity, installed version and pushed state from the three sections", () => {
    expect(
      parseProbeOutput(
        'Linux x86_64\n---penguin---\n{"name":"x","version":"0.2.2"}\n---penguin---\n{"platform":{}}\n',
      ),
    ).toEqual({
      platform: "linux",
      arch: "x64",
      installedVersion: "0.2.2",
      harness: '{"platform":{}}',
    });
  });

  it("a machine with nothing installed answers empty sections", () => {
    expect(parseProbeOutput("Linux x86_64\n---penguin---\n---penguin---\n")).toMatchObject({
      installedVersion: null,
      harness: null,
    });
  });

  it("skips a login banner before the identity line", () => {
    expect(
      parseProbeOutput("Welcome to build-box!\nLinux x86_64\n---penguin---\n---penguin---\n"),
    ).toMatchObject({ platform: "linux", arch: "x64" });
  });

  it("recognizes every platform-arch pair the release targets name", () => {
    expect(parseProbeOutput("Windows_NT AMD64\n---penguin---\n")).toMatchObject({
      platform: "win32",
      arch: "x64",
    });
    expect(parseProbeOutput("Darwin arm64\n---penguin---\n")).toMatchObject({
      platform: "darwin",
      arch: "arm64",
    });
    expect(parseProbeOutput("Linux aarch64\n---penguin---\n")).toMatchObject({
      platform: "linux",
      arch: "arm64",
    });
  });

  it("an unrecognized answer (or an error message) parses as null", () => {
    expect(
      parseProbeOutput("'uname' is not recognized as an internal or external command"),
    ).toBeNull();
    expect(parseProbeOutput("")).toBeNull();
  });

  it("a damaged manifest reads as nothing installed", () => {
    expect(parseProbeOutput("Linux x86_64\n---penguin---\nnot json at all")).toMatchObject({
      installedVersion: null,
    });
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

  it("holds ONE session per machine: no tty, a SOCKS listener on loopback, keepalives, sh", () => {
    const args = sessionArgs(target, 49152).join(" ");
    expect(args).toContain("-T");
    expect(args).toContain("-D 127.0.0.1:49152");
    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args).toContain("ServerAliveInterval=15");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("User=deploy");
    expect(args.endsWith("build-box sh")).toBe(true);
    // Nothing is forwarded by name: any port on the machine is a channel through -D.
    expect(args).not.toContain("-L ");
  });

  it("refuses a SOCKS port that is not one", () => {
    expect(() => sessionArgs(target, 0)).toThrow(/bad port/);
    expect(() => sessionArgs(target, 70000)).toThrow(/bad port/);
  });

  it("repeats the machine's own words when it refuses a build", () => {
    expect(
      refusalDetail(
        409,
        JSON.stringify({ error: { code: "hmr_refused", message: "this runtime is too old" } }),
      ),
    ).toBe("this runtime is too old");
  });

  it("falls back to whatever it did say, rather than inventing a reason", () => {
    expect(refusalDetail(502, "<html>Bad Gateway</html>")).toBe("<html>Bad Gateway</html>");
    expect(refusalDetail(403, "   ")).toContain("403");
  });

  it("leaves the scp destination unquoted — modern scp transfers over SFTP, taking it literally", () => {
    const args = scpArgs(target, ["/local/image.pack"], "/tmp/penguin-abc123");
    expect(args.at(-1)).toBe("build-box:/tmp/penguin-abc123");
  });

  it("quotes per shell: single quotes for sh, double for cmd.exe", () => {
    expect(shQuote("/tmp/it's here")).toBe(`'/tmp/it'\\''s here'`);
    expect(cmdQuote("C:\\Users\\First Last\\tmp")).toBe('"C:\\Users\\First Last\\tmp"');
    expect(() => cmdQuote('C:\\weird"path')).toThrow();
  });

  it("takes the installer on stdin, so a POSIX install costs ONE ssh handshake", () => {
    expect(runInstallScriptCommand("v0.2.4", { platform: "linux" })).toEqual({
      command: "PENGUIN_VERSION='v0.2.4' sh -s",
      scriptOnStdin: true,
    });
  });

  it("runs a Windows remote's copy from a path, and deletes it in the same command", () => {
    expect(
      runInstallScriptCommand("v0.2.4", {
        platform: "win32",
        scriptPath: "%USERPROFILE%\\penguin-ab12.ps1",
      }),
    ).toEqual({
      command:
        'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\penguin-ab12.ps1"' +
        ' -Version "v0.2.4" & del /q "%USERPROFILE%\\penguin-ab12.ps1"',
      scriptOnStdin: false,
    });
  });

  it("unpacks the streamed store into the hmr directory, the layer it was tarred from", () => {
    // install-server.ts tars `-C <root>/hmr harness.json store`, so the members are named
    // from THERE. Extracting into the data root instead lands them one directory above where
    // hmr/host.ts reads them: the machine keeps answering with whatever it already had, and
    // the replication reports success while achieving nothing.
    expect(unpackStoreCommand("linux")).toBe(
      'mkdir -p "$HOME/.penguin/data/hmr" && tar -xzf - -C "$HOME/.penguin/data/hmr"',
    );
    expect(unpackStoreCommand("win32")).toBe(
      '(if not exist "%USERPROFILE%\\.penguin\\data\\hmr" mkdir "%USERPROFILE%\\.penguin\\data\\hmr") & tar -xzf - -C "%USERPROFILE%\\.penguin\\data\\hmr"',
    );
  });
});

describe("resolvePushPlan", () => {
  const manifest = JSON.stringify({ name: "@prismshadow/penguin-cli", version: "0.2.4" });

  it("tarball install: the base release, with no pushed state", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-plan-"));
    try {
      const root = path.join(work, "penguin");
      fs.mkdirSync(path.join(root, "lib", "dist"), { recursive: true });
      fs.writeFileSync(path.join(root, "lib", "dist", "penguin.js"), "//\n");
      fs.writeFileSync(path.join(root, "lib", "package.json"), manifest);

      const plan = resolvePushPlan(work, path.join(root, "lib", "dist", "penguin.js"));
      expect(plan).toMatchObject({ baseVersion: "0.2.4", harness: null, version: "0.2.4" });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("a pushed server adds its hmr state, sha-suffixed", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-plan-"));
    try {
      const root = path.join(work, "penguin");
      fs.mkdirSync(path.join(root, "lib", "dist"), { recursive: true });
      fs.writeFileSync(path.join(root, "lib", "dist", "penguin.js"), "//\n");
      fs.writeFileSync(path.join(root, "lib", "package.json"), manifest);
      const hmrDir = path.join(work, "data", "hmr");
      fs.mkdirSync(hmrDir, { recursive: true });
      const harness = JSON.stringify({
        platform: { bundle: "store/platform/cafe0123456789ab.mjs" },
      });
      fs.writeFileSync(path.join(hmrDir, "harness.json"), harness);

      const plan = resolvePushPlan(
        path.join(work, "data"),
        path.join(root, "lib", "dist", "penguin.js"),
      );
      expect(plan).toMatchObject({
        baseVersion: "0.2.4",
        harness,
        hmrDir,
        version: "0.2.4+hmr.cafe01234567",
      });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("packaged desktop app: its own manifest names the release it shipped under", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-plan-"));
    try {
      const appDir = path.join(work, "resources", "app");
      fs.mkdirSync(path.join(appDir, "dist"), { recursive: true });
      fs.writeFileSync(
        path.join(appDir, "package.json"),
        JSON.stringify({ name: "@prismshadow/penguin-desktop", version: "0.2.4" }),
      );

      const plan = resolvePushPlan(null, path.join(appDir, "dist", "server.js"));
      expect(plan).toMatchObject({ baseVersion: "0.2.4" });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("a desktop SOURCE run stands on no release: packages/desktop is not under resources/", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-plan-"));
    try {
      const pkgDir = path.join(work, "packages", "desktop");
      fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "@prismshadow/penguin-desktop", version: "0.2.4" }),
      );

      expect(resolvePushPlan(null, path.join(pkgDir, "dist", "server.js"))).toBeNull();
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("a dev checkout stands on no release and answers null", () => {
    expect(resolvePushPlan(null, "/repo/packages/server/src/index.ts")).toBeNull();
    expect(resolvePushPlan(null, undefined)).toBeNull();
  });
});

describe("shipping the installers", () => {
  /**
   * The push copies these files out of dist/; they are never imported, so nothing in the
   * module graph would notice one going missing from a built package. The build copies them
   * in (tsup.config.ts's onSuccess), and that copy is worth an assertion rather than a comment.
   */
  it.each(["install.sh", "install.ps1"])("%s is copied into dist at build time", (name) => {
    const built = path.resolve(__dirname, "..", "dist", name);
    if (!fs.existsSync(built)) return; // Not built in this run; `pnpm build` covers it in CI.
    const source = path.resolve(__dirname, "..", "..", "..", name);
    expect(fs.readFileSync(built, "utf8")).toBe(fs.readFileSync(source, "utf8"));
  });
});

describe("asking `penguin server status` in the machine's own dialect", () => {
  const target = { alias: "nas", user: "deploy" };
  const answered = {
    code: 0,
    stdout: `${JSON.stringify({ running: true, port: 7364, pid: 42, machineId: "LNrJdHAZJ91G58i0" })}\n`,
    stderr: "",
    timedOut: false,
  };
  // What cmd.exe says to `"$HOME/.penguin/node/bin/node"`: not "no such command", a path
  // with four literal characters in it.
  const cmdSaid = {
    code: 1,
    stdout: "The system cannot find the path specified.\r\n",
    stderr: "",
    timedOut: false,
  };

  it("speaks cmd.exe to a Windows machine: no $HOME, node.exe, backslashes", () => {
    const command = readServerStateCommand("win32");
    expect(command).toContain("%USERPROFILE%\\.penguin\\node\\node.exe");
    expect(command).toContain("lib\\dist\\penguin-hmr.js");
    expect(command).not.toContain("$HOME");
    expect(readServerStateCommand("linux")).toContain("$HOME/.penguin/node/bin/node");
  });

  it("a machine whose platform is on record is asked once, in that dialect", async () => {
    const asked: string[] = [];
    const probe = await probeServerState(
      target,
      async (_t, command) => {
        asked.push(command);
        return answered;
      },
      "win32",
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("%USERPROFILE%");
    expect(probe.state).toMatchObject({ kind: "running", port: 7364 });
  });

  it("a machine whose platform is unknown is asked the POSIX way, then the Windows way", async () => {
    const asked: string[] = [];
    const probe = await probeServerState(
      target,
      async (_t, command) => {
        asked.push(command);
        return command.includes("%USERPROFILE%") ? answered : cmdSaid;
      },
      null,
    );
    expect(asked).toHaveLength(2);
    expect(probe).toMatchObject({ state: { kind: "running" }, machineId: "LNrJdHAZJ91G58i0" });
  });

  it("when neither dialect answers, what the POSIX attempt heard is what is reported", async () => {
    const refused = {
      code: 255,
      stdout: "",
      stderr: "ssh: connect to host nas port 22: Connection refused",
      timedOut: false,
    };
    const probe = await probeServerState(target, async () => refused, null);
    expect(probe.state).toMatchObject({
      kind: "unreachable",
      detail: expect.stringContaining("Connection refused"),
    });
  });
});

describe("reading what `penguin server status` answered", () => {
  const answer = (o: Record<string, unknown>) => JSON.stringify(o);

  it("takes the state and the id out of the machine's own JSON", () => {
    expect(
      parseProbe(answer({ running: true, port: 7364, pid: 42, machineId: "LNrJdHAZJ91G58i0" })),
    ).toEqual({ state: { kind: "running", port: 7364, pid: 42 }, machineId: "LNrJdHAZJ91G58i0" });
  });

  it("reads a machine with nothing serving, and one that has no id yet", () => {
    expect(parseProbe(answer({ running: false, port: null, pid: null, machineId: null }))).toEqual({
      state: { kind: "stopped" },
      machineId: null,
    });
  });

  it("finds the answer under a login shell's own banner", () => {
    const said = `Welcome to build-box!\n{ not json }\n${answer({ running: false })}\n`;
    expect(parseProbe(said).state).toEqual({ kind: "stopped" });
  });

  it("says it cannot tell rather than inventing a state out of a shape it does not know", () => {
    // Neither of these is a state any machine reported; both would be made up on this side.
    // A truthy string reads as up, and a claim of running carrying no port reads as down —
    // the two directions this side could least afford to be wrong in.
    const stringly = answer({ running: "false", port: 1, pid: 2 });
    expect(parseProbe(stringly).state).toEqual({ kind: "unreachable", detail: stringly });
    const portless = answer({ running: true, machineId: "LNrJdHAZJ91G58i0" });
    expect(parseProbe(portless).state).toEqual({ kind: "unreachable", detail: portless });
  });

  it("says it cannot tell rather than 'stopped' when there is no answer at all", () => {
    // A build too old for the subcommand prints an error. Reading that as a well-formed "no"
    // would turn every such machine into a silently wrong one.
    const said = "error: unknown command 'status'";
    expect(parseProbe(said).state).toEqual({ kind: "unreachable", detail: said });
  });
});

describe("readPushedBuild", () => {
  it("hands on the native assets and the provenance, not only the three bundles", () => {
    // A platform resolves node-pty out of its assets directory and nowhere else; a hand-over
    // without them left every terminal on the machine failing with "no assets directory".
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-handover-"));
    try {
      const hmr = path.join(root, "hmr");
      const assets = path.join(hmr, "store", "assets", "abc");
      fs.mkdirSync(path.join(assets, "node_modules", "node-pty", "prebuilds", "darwin-arm64"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(hmr, "store", "platform"), { recursive: true });
      fs.mkdirSync(path.join(hmr, "store", "cli"), { recursive: true });
      fs.mkdirSync(path.join(hmr, "store", "web"), { recursive: true });
      fs.writeFileSync(path.join(hmr, "store", "platform", "p.mjs"), "platform");
      fs.writeFileSync(path.join(hmr, "store", "cli", "c.mjs"), "cli");
      fs.writeFileSync(
        path.join(hmr, "store", "web", "w.webz"),
        zlib.gzipSync(Buffer.from(JSON.stringify({ files: { "index.html": "aGk=" } }))),
      );
      const helper = path.join(
        assets,
        "node_modules",
        "node-pty",
        "prebuilds",
        "darwin-arm64",
        "spawn-helper",
      );
      fs.writeFileSync(helper, "bin");
      fs.chmodSync(helper, 0o755);
      fs.writeFileSync(path.join(assets, "node_modules", "node-pty", "package.json"), "{}");
      fs.writeFileSync(path.join(assets, ".materialized"), "");
      fs.writeFileSync(
        path.join(hmr, "harness.json"),
        JSON.stringify({
          platform: { bundle: "store/platform/p.mjs" },
          cli: { bundle: "store/cli/c.mjs" },
          web: { manifest: "store/web/w.webz" },
          assets: { dir: "store/assets/abc" },
          source: { repo: "https://example.com/r.git", revision: "v1-3-gabc" },
        }),
      );

      const body = readPushedBuild(root);
      if (body === null) throw new Error("no body");
      const payload = JSON.parse(zlib.gunzipSync(body).toString("utf8")) as {
        platform: string;
        assets?: { files: Record<string, string>; exec: string[] };
        source?: { repo: string; revision: string };
      };
      expect(payload.platform).toBe("platform");
      expect(Object.keys(payload.assets?.files ?? {}).sort()).toEqual([
        "node_modules/node-pty/package.json",
        "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
      ]);
      // The marker is the host's bookkeeping, not an asset; the exec bit travels as a list —
      // and the spawn-helper is on it by NAME, so a Windows sender, which has no exec bit to
      // read, hands it over runnable too (the chmod above is a no-op there).
      expect(payload.assets?.exec).toEqual([
        "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
      ]);
      expect(payload.source).toEqual({ repo: "https://example.com/r.git", revision: "v1-3-gabc" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("still hands on a build that was pushed without assets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-handover-"));
    try {
      const hmr = path.join(root, "hmr");
      fs.mkdirSync(path.join(hmr, "s"), { recursive: true });
      fs.writeFileSync(path.join(hmr, "s", "p.mjs"), "p");
      fs.writeFileSync(path.join(hmr, "s", "c.mjs"), "c");
      fs.writeFileSync(
        path.join(hmr, "s", "w.webz"),
        zlib.gzipSync(Buffer.from(JSON.stringify({ files: {} }))),
      );
      fs.writeFileSync(
        path.join(hmr, "harness.json"),
        JSON.stringify({
          platform: { bundle: "s/p.mjs" },
          cli: { bundle: "s/c.mjs" },
          web: { manifest: "s/w.webz" },
        }),
      );
      const body = readPushedBuild(root);
      if (body === null) throw new Error("no body");
      const payload = JSON.parse(zlib.gunzipSync(body).toString("utf8")) as Record<string, unknown>;
      expect("assets" in payload).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
