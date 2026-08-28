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
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { machineIdentity, parseHostAliases, parseSshSettings } from "../src/machines/ssh-config.js";
import { parseProbeOutput, POSIX_PROBE, WINDOWS_PROBE } from "../src/machines/detect.js";
import { parseProbe } from "../src/machines/server-state.js";
import {
  cmdQuote,
  runInstallScriptCommand,
  unpackStoreCommand,
  scpArgs,
  shQuote,
  sshArgs,
  forwardArgs,
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

  it("forwards a machine's API on any free local port, unlike the browser's same-numbered tunnel", () => {
    // tunnelArgs must keep both ends equal because preview URLs carry the server's own bound
    // port. Nothing built from THIS forward reaches a browser, so it takes what is free here
    // — which is what lets a machine on the default port be reached by a controller on it.
    const args = forwardArgs(target, 49152, 7364).join(" ");
    expect(args).toContain("-L 49152:127.0.0.1:7364");
    // Or "local port taken" would be a silent forward to nowhere instead of an exit.
    expect(args).toContain("ExitOnForwardFailure=yes");
  });

  it("refuses to build a forward around a port that is not one", () => {
    expect(() => forwardArgs(target, 0, 7364)).toThrow(/bad port/);
    expect(() => forwardArgs(target, 7364, 70000)).toThrow(/bad port/);
  });

  it("repeats the machine's own words when it refuses a build", () => {
    // The endpoint answers the API error envelope, and its message is the actionable half —
    // a runtime that cannot claim this platform names itself there.
    expect(
      refusalDetail(
        409,
        JSON.stringify({ error: { code: "hmr_refused", message: "this runtime is too old" } }),
      ),
    ).toBe("this runtime is too old");
  });

  it("falls back to whatever it did say, rather than inventing a reason", () => {
    // Not every refusal comes from the API: a reverse proxy or a wrong port answers HTML.
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
    // cmd.exe has no escape for a quote inside a quoted string: refuse rather than mangle.
    expect(() => cmdQuote('C:\\weird"path')).toThrow();
  });

  it("takes the installer on stdin, so a POSIX install costs ONE ssh handshake", () => {
    // No path anywhere in it: nothing was copied, so nothing has to be placed or cleaned up.
    // scriptOnStdin is the other half — the command alone would run an empty `sh -s`.
    expect(runInstallScriptCommand("v0.2.4", { platform: "linux" })).toEqual({
      command: "PENGUIN_VERSION='v0.2.4' sh -s",
      scriptOnStdin: true,
    });
  });

  it("runs a Windows remote's copy from a path, and deletes it in the same command", () => {
    // PowerShell cannot take a param()-carrying script on stdin, so the file is real there —
    // but the delete rides the same connection rather than costing another handshake, and the
    // path is required to build the command at all rather than defaulting to an empty one.
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

  it("unpacks the streamed store into the default data root", () => {
    expect(unpackStoreCommand("linux")).toBe(
      'mkdir -p "$HOME/.penguin/data" && tar -xzf - -C "$HOME/.penguin/data"',
    );
    expect(unpackStoreCommand("win32")).toBe(
      '(if not exist "%USERPROFILE%\\.penguin\\data" mkdir "%USERPROFILE%\\.penguin\\data") & tar -xzf - -C "%USERPROFILE%\\.penguin\\data"',
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
      // What the app forks: <resources>/app/dist/server.js, one bundled file, asar off.
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
    // sshd runs this in a shell that may greet, warn about updates, or print an MOTD.
    const said = `Welcome to build-box!\n{ not json }\n${answer({ running: false })}\n`;
    expect(parseProbe(said).state).toEqual({ kind: "stopped" });
  });

  it("says it cannot tell rather than 'stopped' when there is no answer at all", () => {
    // A build too old for the subcommand. Reporting "stopped" would make it indistinguishable
    // from a healthy machine that simply is not running — and it would never be looked at.
    const said = "error: unknown command 'status'";
    expect(parseProbe(said).state).toEqual({ kind: "unreachable", detail: said });
  });
});
