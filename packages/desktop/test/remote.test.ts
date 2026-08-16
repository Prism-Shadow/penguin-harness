/**
 * The pure half of "install a server on that machine": reading ~/.ssh/config and `ssh -G`,
 * reading the probe's answer, deciding what to do with it, and the exact ssh/scp commands
 * that decision turns into. No network, no ssh binary, no Electron.
 */
import { describe, expect, it } from "vitest";
import { machineIdentity, parseHostAliases, parseSshSettings } from "../src/remote/ssh-config.js";
import {
  MIN_REMOTE_NODE_MAJOR,
  parseProbe,
  planRemoteInstall,
  PROBE_COMMAND,
} from "../src/remote/probe.js";
import { payloadSourcesReady, resolvePayloadSources } from "../src/remote/install-server.js";
import {
  cleanupCommand,
  installCommand,
  scpArgs,
  shQuote,
  sshArgs,
} from "../src/remote/commands.js";

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
        "forwardagent no",
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
    expect(settings.identityFiles).toEqual([]);
    expect(settings.proxyJump).toBeNull();
  });
});

describe("machineIdentity", () => {
  it("is <user>@<alias>: the Linux account is part of the machine, the alias is the name", () => {
    // Two accounts on one host are two machines — each has its own ~/.penguin, hence its
    // own server and its own user table.
    expect(machineIdentity("build-box", "deploy")).toBe("deploy@build-box");
    expect(machineIdentity("build-box", "root")).toBe("root@build-box");
    // No resolved user (ssh will pick): the alias alone names it.
    expect(machineIdentity("build-box", "")).toBe("build-box");
  });
});

describe("PROBE_COMMAND", () => {
  it("uses absolute paths only — a non-login shell has neither ~/.local/bin nor a PATH for it", () => {
    expect(PROBE_COMMAND).toContain('"${XDG_DATA_HOME:-$HOME/.local/share}"/penguin/bin/penguin');
    expect(PROBE_COMMAND).toContain('"$HOME"/.penguin/data/server.lock');
    expect(PROBE_COMMAND).not.toMatch(/(^|[^/\w])penguin --version/);
  });

  it("guards every line so a bare machine still answers instead of failing the ssh", () => {
    for (const fragment of ["2>/dev/null", "||"]) expect(PROBE_COMMAND).toContain(fragment);
  });
});

describe("parseProbe", () => {
  it("reads the key=value answer of a machine that has everything", () => {
    expect(
      parseProbe('penguin=0.2.2\nuname=Linux x86_64\nnode=v24.3.0\nlock={"pid":12}\n'),
    ).toEqual({
      version: "0.2.2",
      uname: "Linux x86_64",
      nodeVersion: "v24.3.0",
      lock: '{"pid":12}',
    });
  });

  it("empty values become null, and stray output is ignored", () => {
    expect(parseProbe("warning: something\npenguin=\nuname=Linux x86_64\nnode=\nlock=")).toEqual({
      version: null,
      uname: "Linux x86_64",
      nodeVersion: null,
      lock: null,
    });
  });
});

describe("planRemoteInstall", () => {
  const base = { version: null, uname: "Linux x86_64", nodeVersion: "v24.3.0", lock: null };

  it("installs onto a bare machine", () => {
    expect(planRemoteInstall(base, "0.2.2")).toEqual({ action: "install", reason: "absent" });
  });

  it("uses an install that already matches this build exactly", () => {
    expect(planRemoteInstall({ ...base, version: "0.2.2" }, "0.2.2")).toEqual({
      action: "use",
      remoteVersion: "0.2.2",
    });
  });

  it("replaces any other version — the program is one build, not three parts to reconcile", () => {
    // Newer as well as older: CLI, server and web ship together, so "different" is enough.
    expect(planRemoteInstall({ ...base, version: "0.2.1" }, "0.2.2")).toEqual({
      action: "install",
      reason: "version-mismatch",
      remoteVersion: "0.2.1",
    });
    expect(planRemoteInstall({ ...base, version: "0.3.0" }, "0.2.2")).toMatchObject({
      action: "install",
      reason: "version-mismatch",
    });
  });

  it("refuses up front when the remote's Node cannot run the payload", () => {
    expect(planRemoteInstall({ ...base, nodeVersion: null }, "0.2.2")).toMatchObject({
      action: "blocked",
      reason: "no-node",
    });
    expect(planRemoteInstall({ ...base, nodeVersion: "v20.11.0" }, "0.2.2")).toMatchObject({
      action: "blocked",
      reason: "node-too-old",
    });
    // …but a matching install is used without asking about Node at all: it already runs.
    expect(
      planRemoteInstall({ ...base, version: "0.2.2", nodeVersion: null }, "0.2.2"),
    ).toMatchObject({ action: "use" });
    expect(MIN_REMOTE_NODE_MAJOR).toBe(24);
  });

  it("treats a silent probe as unreachable rather than as an empty machine", () => {
    expect(planRemoteInstall({ ...base, uname: null }, "0.2.2")).toMatchObject({
      action: "blocked",
      reason: "unreachable",
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
    // No resolved user: ssh decides, and we add no override.
    expect(sshArgs({ alias: "build-box", user: "" }, "true").join(" ")).not.toContain("User=");
  });

  it("puts the alias and the remote command last, in that order", () => {
    const args = sshArgs(target, "mktemp -d");
    expect(args.slice(-2)).toEqual(["build-box", "mktemp -d"]);
  });

  it("scp copies to the target directory on the far side", () => {
    const args = scpArgs(target, ["/local/payload.tar.gz", "/local/install.sh"], "/tmp/x y");
    expect(args.slice(-3)).toEqual([
      "/local/payload.tar.gz",
      "/local/install.sh",
      "build-box:'/tmp/x y'/",
    ]);
  });

  it("quotes for the remote shell, including embedded quotes", () => {
    expect(shQuote("/tmp/plain")).toBe("'/tmp/plain'");
    expect(shQuote("/tmp/it's here")).toBe(`'/tmp/it'\\''s here'`);
  });

  it("runs the installer with --universal, which the pushed payload requires", () => {
    // Without it install.sh validates the manifest against the host's own target and
    // refuses: "package target mismatch: expected linux-x64, found universal".
    const command = installCommand("/tmp/penguin.XXXX", "payload.tar.gz");
    expect(command).toBe(
      "sh '/tmp/penguin.XXXX/install.sh' --universal --archive '/tmp/penguin.XXXX/payload.tar.gz'",
    );
    expect(cleanupCommand("/tmp/penguin.XXXX")).toBe("rm -rf '/tmp/penguin.XXXX'");
  });
});

describe("resolvePayloadSources", () => {
  it("packaged: the image and the installer ride as app resources", () => {
    expect(
      resolvePayloadSources({
        packaged: true,
        resourcesPath: "/Applications/PenguinHarness.app/Contents/Resources",
        repoRoot: "/ignored",
      }),
    ).toEqual({
      payloadRoot: "/Applications/PenguinHarness.app/Contents/Resources/payload",
      installerPath: "/Applications/PenguinHarness.app/Contents/Resources/install.sh",
    });
  });

  it("dev run: straight out of the repository, so the feature works before packaging", () => {
    expect(
      resolvePayloadSources({ packaged: false, resourcesPath: "/ignored", repoRoot: "/repo" }),
    ).toEqual({
      payloadRoot: "/repo/packages/desktop/stage/payload",
      installerPath: "/repo/install.sh",
    });
  });

  it("reports sources that are not actually there (a dev run that never staged)", () => {
    expect(
      payloadSourcesReady({ payloadRoot: "/nope/payload", installerPath: "/nope/install.sh" }),
    ).toBe(false);
  });
});
