/**
 * installOnRemote's orchestration, driven against a scripted channel: which dialect it probes
 * in and over what, that the release installer rides the session's stdin pinned to the base,
 * that the hmr store rides the same stdin as a tarball, that a Windows host gets its own
 * connection and a copied script, and each outcome the page renders. The channel is what a
 * real MachineConnection speaks (transport/connection.ts); here every verb is recorded and
 * answered as the scenario dictates, so what is exercised is what the install asks of a
 * machine, not the far side.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as tar from "tar";
import { installOnRemote, packHmrState } from "../src/machines/install-server.js";
import { remoteLayoutFor } from "../src/machines/layout.js";
import type { PushPlan } from "../src/machines/install-server.js";
import type { ExecResult, MachineChannel } from "../src/machines/transport/index.js";

const RELEASE = remoteLayoutFor("release");

interface Call {
  verb: "exec" | "stream" | "oneShot" | "copyTo";
  command: string;
  input?: Buffer;
}

/** How a scripted machine answers. */
interface Script {
  probe: string;
  /**
   * What the probe answers ONCE the installer has run. The install path asks twice, and the
   * second answer is the machine reporting what it ended up with — a script that said the
   * same both times could not tell an install that took from one that ran cleanly and
   * changed nothing, which is the case the second ask exists for.
   */
  afterInstall?: string;
  /** A cmd.exe host: no `sh` to hold a session on, so the session dies unopened. */
  windows?: boolean;
  installExit?: number;
  /** What the installer prints, line by line as the session relays it; a success line by default. */
  installSays?: string[];
  /** How the machine reaches the two release sources (releaseReachCommand's answer); both by default. */
  reach?: string;
}

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "", timedOut: false });

function scripted(script: Script): MachineChannel & { calls: Call[] } {
  const calls: Call[] = [];
  let ran = false;
  const identity = () =>
    (ran ? (script.afterInstall ?? script.probe) : script.probe).replaceAll("\\n", "\n");
  const answer = (call: Call, onLine?: (line: string) => void): ExecResult => {
    calls.push(call);
    const { command } = call;
    if (command.includes("tar.gz.sha256")) {
      return ok(script.reach ?? "@@oss 206 0\n@@github 206 0\n");
    }
    if (command.startsWith("mktemp -d")) return ok("/tmp/penguin-release.Ab12Cd\n");
    if (command.includes("uname")) {
      return script.windows
        ? {
            code: 255,
            stdout:
              "the connection to this machine ended: 'sh' is not recognized as an internal or external command",
            stderr: "",
            timedOut: false,
          }
        : ok(identity());
    }
    if (command.includes("PROCESSOR_ARCHITECTURE")) return ok(identity());
    if (command.includes("sh -s") || command.includes("powershell")) {
      ran = true;
      const says = script.installSays ?? ["PenguinHarness 0.2.4 installed"];
      for (const line of says) onLine?.(line);
      return { ...ok(`${says.join("\n")}\n`), code: script.installExit ?? 0 };
    }
    return ok("");
  };
  return {
    calls,
    exec: async (command) => answer({ verb: "exec", command }),
    stream: async (command, opts) =>
      answer({ verb: "stream", command, input: opts.input }, opts.onLine),
    oneShot: async (command, opts = {}) =>
      answer(
        opts.input === undefined
          ? { verb: "oneShot", command }
          : { verb: "oneShot", command, input: opts.input },
      ),
    copyTo: async (localFiles, remoteDir) => {
      calls.push({
        verb: "copyTo",
        command: `${localFiles.map((f) => path.basename(f)).join(" ")} -> ${remoteDir}`,
      });
      return ok("");
    },
  };
}

describe("installOnRemote", () => {
  let work: string;
  const HARNESS = '{"platform":{"bundle":"store/platform/cafe0123456789ab.mjs"}}';

  /** A plan the way resolvePushPlan builds one, with a real hmr dir to pack. */
  const plan = (over: Partial<PushPlan> = {}): PushPlan => {
    const hmrDir = path.join(work, "hmr");
    fs.mkdirSync(path.join(hmrDir, "store"), { recursive: true });
    fs.writeFileSync(path.join(hmrDir, "harness.json"), HARNESS);
    fs.writeFileSync(path.join(hmrDir, "store", "x.mjs"), "//\n");
    return {
      baseVersion: "0.2.4",
      harness: HARNESS,
      hmrDir,
      version: "0.2.4+hmr.cafe01234567",
      ...over,
    };
  };

  /** Where the push finds install.sh / install.ps1 — the repo root, in a source checkout. */
  const assets = () => path.resolve(__dirname, "..", "..", "..");

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-push-test-"));
  });
  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  const target = { alias: "build-box", user: "deploy" };

  it("probes, installs and replicates over the ONE session, then asks what the machine now has", async () => {
    const channel = scripted({
      probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n",
      afterInstall: `Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n${HARNESS}`,
    });
    const progress: string[] = [];
    const outcome = await installOnRemote({
      target,
      layout: RELEASE,
      plan: plan(),
      assets,
      channel,
      onProgress: (line) => progress.push(line),
    });

    expect(outcome).toMatchObject({ kind: "installed" });
    const { calls } = channel;
    // Four commands, all on the session: no one-shot connection, no scp, no scratch dir.
    expect(calls.map((c) => c.verb)).toEqual(["exec", "stream", "stream", "exec"]);
    expect(calls[0]!.command).toContain("uname -s -m"); // identity first
    // The release is downloaded ON THE REMOTE, pinned to this server's own base, the
    // installer riding the session's stdin.
    expect(calls[1]!.command).toContain("PENGUIN_VERSION='v0.2.4' sh -s");
    expect(calls[1]!.input?.toString("utf8").startsWith("#!/")).toBe(true);
    // The hmr state crosses the same stdin as a tarball, into the hmr directory it was
    // tarred from.
    expect(calls[2]!.command).toContain('tar -xzf - -C "$HOME/.penguin/data/hmr"');
    expect(calls[2]!.input?.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b])); // gzip
    // And the machine is asked what it ended up with, which is the only step that can tell
    // an install that took from one that ran cleanly and changed nothing.
    expect(calls[3]!.command).toContain("uname -s -m");
    expect(progress).toContain("linux-x64.");
    // The far side's own output is relayed as it arrives, not withheld until exit.
    expect(progress).toContain("PenguinHarness 0.2.4 installed");
  });

  it("calls an install that ran cleanly and changed nothing a failure", async () => {
    // The installer exits 0 and says it installed; the machine still has nothing. Every step
    // answers for itself and none of them answers whether the thing on disk over there is now
    // this version — so without asking afterwards this is a success recorded at OUR version,
    // and syncOutOfDate filters on exactly that: the machine is excluded from the sweep that
    // would have tried again. A false success here seals itself in.
    const channel = scripted({ probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n" });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });

    expect(outcome).toMatchObject({ kind: "failed", step: "verify the install" });
    expect((outcome as { detail: string }).detail).toContain("still has no install");
  });

  it("calls a base that took without the pushed state a failure", async () => {
    // The store's unpack exited 0 and the base is exactly right, so every step answered for
    // itself; only the second probe can tell that the pushed half never landed. Blessing this
    // would record the machine at plan.version — the base plus that state's sha — and
    // syncOutOfDate filters on that record, so the machine would be left out of the very
    // sweep that would have pushed again.
    const channel = scripted({
      probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n",
      afterInstall: 'Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n',
    });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });

    expect(outcome).toMatchObject({ kind: "failed", step: "verify the install" });
    expect((outcome as { detail: string }).detail).toContain("no pushed state");
  });

  it("a Windows host has no session to hold: the probe, a copied script and the store each get their own connection", async () => {
    const channel = scripted({
      probe: "Windows_NT AMD64\\n---penguin---\\n---penguin---\\n",
      afterInstall: `Windows_NT AMD64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n${HARNESS}`,
      windows: true,
    });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });

    expect(outcome).toMatchObject({ kind: "installed" });
    const { calls } = channel;
    // The session is tried first and dies unopened (cmd.exe has no sh); the Windows probe
    // then goes on a connection of its own.
    expect(calls[0]).toMatchObject({ verb: "exec" });
    expect(calls[0]!.command).toContain("uname -s -m");
    expect(calls[1]).toMatchObject({ verb: "oneShot" });
    expect(calls[1]!.command).toContain("%PROCESSOR_ARCHITECTURE%");
    // PowerShell cannot take the script on stdin, so a Windows remote gets a copy — scp'd to
    // the home directory, with the delete chained onto the command that runs it.
    expect(calls[2]!.verb).toBe("copyTo");
    expect(calls[2]!.command).toMatch(/^penguin-[0-9a-f]+\.ps1 -> \.$/);
    expect(calls[3]!.verb).toBe("oneShot");
    expect(calls[3]!.command).toContain('-File "%USERPROFILE%\\penguin-');
    expect(calls[3]!.command).toContain('-Version "v0.2.4"');
    expect(calls[3]!.command).toContain("& del /q");
    // The store, as stdin to a one-shot tar.
    expect(calls[4]).toMatchObject({ verb: "oneShot" });
    expect(calls[4]!.command).toContain("tar -xzf -");
    expect(calls[4]!.input?.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
  });

  it("a matching base is a hot update to hand on, not an install to perform", async () => {
    // Same release, different pushed state. Nothing to install — and streaming the store over
    // and restarting the process would swap the code under a server without asking whether it
    // can claim it: a runtime older than the pushed platform warns, falls back to its packaged
    // default and keeps serving, so from here the restart reads as a success. The caller sends
    // this down the machine's own update channel, which answers.
    const channel = scripted({
      probe: 'Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n',
    });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });
    expect(outcome).toMatchObject({ kind: "state-only" });
    // The probe, and nothing else: no installer, and no store either.
    expect(channel.calls).toHaveLength(1);
  });

  it("does nothing when the remote already matches base AND pushed state", async () => {
    const channel = scripted({
      probe: `Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n${HARNESS}\\n`,
    });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });
    expect(outcome).toMatchObject({ kind: "already-installed", version: "0.2.4+hmr.cafe01234567" });
    expect(channel.calls).toHaveLength(1); // the probe, and nothing else
  });

  it("packs the replicated state in this process: the state's own files, the helper still executable", async () => {
    const p = plan();
    const helper = path.join(p.hmrDir!, "store", "assets", "a1", "spawn-helper");
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.writeFileSync(helper, "#!");
    fs.chmodSync(helper, 0o755);
    const file = path.join(work, "state.tgz");
    fs.writeFileSync(file, await packHmrState(p.hmrDir!));
    const files = new Map<string, number>();
    await tar.t({
      file,
      onReadEntry: (entry) => {
        if (entry.type === "File") files.set(entry.path, entry.mode ?? 0);
      },
    });
    expect([...files.keys()].sort()).toEqual([
      "harness.json",
      "store/assets/a1/spawn-helper",
      "store/x.mjs",
    ]);
    if (process.platform !== "win32") {
      expect(files.get("store/assets/a1/spawn-helper")! & 0o111).not.toBe(0);
    }
  });

  describe("a machine that cannot download the release itself", () => {
    const fresh = "Linux x86_64\\n---penguin---\\n---penguin---\\n";
    const after = `Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n${HARNESS}`;

    it("gets the package from this side: sent into a scratch directory, installed from it, the scratch removed", async () => {
      const pkg = path.join(work, "penguin-linux-x64.tar.gz");
      fs.writeFileSync(pkg, "the package");
      const asked: string[] = [];
      const channel = scripted({
        probe: fresh,
        afterInstall: after,
        reach: "@@oss 000 7\n@@github 000 28\n",
      });
      const outcome = await installOnRemote({
        target,
        plan: plan(),
        assets,
        channel,
        layout: RELEASE,
        carryRelease: async (version, platform) => {
          asked.push(`${version} ${platform}`);
          return { ok: true, file: pkg };
        },
      });
      expect(outcome).toMatchObject({ kind: "installed" });
      expect(asked).toEqual(["0.2.4 linux-x64"]);
      const archive = "/tmp/penguin-release.Ab12Cd/penguin-linux-x64.tar.gz";
      const sent = channel.calls.find((c) => c.command.startsWith("cat > "));
      expect(sent?.command).toBe(`cat > "${archive}"`);
      expect(sent?.input?.toString()).toBe("the package");
      const install = channel.calls.find((c) => c.command.includes("sh -s"));
      expect(install?.command).toContain(`PENGUIN_ARCHIVE='${archive}'`);
      expect(install?.command).not.toContain("PENGUIN_VERSION");
      expect(channel.calls.at(-1)?.command).toBe('rm -rf "/tmp/penguin-release.Ab12Cd"');
    });

    it("downloads it there after all when one source answers", async () => {
      let carried = 0;
      const channel = scripted({
        probe: fresh,
        afterInstall: after,
        reach: "@@oss 000 7\n@@github 206 0\n",
      });
      await installOnRemote({
        target,
        plan: plan(),
        assets,
        channel,
        layout: RELEASE,
        carryRelease: async () => {
          carried += 1;
          return { ok: false, detail: "unused" };
        },
      });
      expect(carried).toBe(0);
      expect(channel.calls.find((c) => c.command.includes("sh -s"))?.command).toContain(
        "PENGUIN_VERSION='v0.2.4'",
      );
    });

    it("stops before sending anything when both sources answer and neither has the release", async () => {
      const channel = scripted({ probe: fresh, reach: "@@oss 404 0\n@@github 404 0\n" });
      const outcome = await installOnRemote({
        target,
        plan: plan(),
        assets,
        channel,
        layout: RELEASE,
        carryRelease: async () => ({ ok: false, detail: "unused" }),
      });
      expect(outcome).toMatchObject({ kind: "failed", step: "download the release" });
      expect((outcome as { detail: string }).detail).toContain("v0.2.4");
      expect(channel.calls.some((c) => c.command.includes("sh -s"))).toBe(false);
    });

    it("says so when this side cannot fetch the package either", async () => {
      const channel = scripted({ probe: fresh, reach: "@@nocurl\n" });
      const outcome = await installOnRemote({
        target,
        plan: plan(),
        assets,
        channel,
        layout: RELEASE,
        carryRelease: async () => ({ ok: false, detail: "the mirror: fetch failed; GitHub: 403" }),
      });
      expect(outcome).toMatchObject({ kind: "failed", step: "download the release" });
      expect((outcome as { detail: string }).detail).toContain("GitHub: 403");
      expect(channel.calls.some((c) => c.command.includes("sh -s"))).toBe(false);
    });
  });

  it("a bare release plan streams nothing", async () => {
    const channel = scripted({
      probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n",
      afterInstall: 'Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n',
    });
    const outcome = await installOnRemote({
      target,
      layout: RELEASE,
      plan: plan({ harness: null, hmrDir: null, version: "0.2.4" }),
      assets,
      channel,
    });
    expect(outcome).toMatchObject({ kind: "installed" });
    expect(channel.calls.some((c) => c.command.includes("tar -xzf -"))).toBe(false);
  });

  it("reports the installer's own output on failure", async () => {
    const channel = scripted({
      probe: 'Linux x86_64\\n---penguin---\\n{"version":"0.0.1"}\\n---penguin---\\n',
      installExit: 3,
    });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });
    expect(outcome).toMatchObject({ kind: "failed", step: "install" });
    expect((outcome as { detail: string }).detail).toContain("PenguinHarness 0.2.4 installed");
  });

  it("leads ssh's own words with what to do when the session cannot be opened, and asks no second connection", async () => {
    const channel = scripted({ probe: "" });
    channel.exec = async (command) => {
      channel.calls.push({ verb: "exec", command });
      return {
        code: 255,
        stdout:
          "the connection to this machine ended: deploy@build-box: Permission denied (publickey).",
        stderr: "",
        timedOut: false,
      };
    };
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });
    expect(outcome).toMatchObject({ kind: "failed", step: "connect" });
    const { detail } = outcome as { detail: string };
    expect(detail).toMatch(/^build-box did not accept any key/);
    expect(detail).toContain("authorized_keys");
    expect(detail).toContain("Permission denied (publickey)");
    // ssh refused before any shell: the Windows dialect is not tried on a second connection.
    expect(channel.calls.map((c) => c.verb)).toEqual(["exec"]);
  });

  it("an unknown host key says to connect once by hand, not to set up a key", async () => {
    const channel = scripted({ probe: "" });
    channel.exec = async () => ({
      code: 255,
      stdout:
        "No ED25519 host key is known for box.example.net and you have requested strict checking.\nHost key verification failed.",
      stderr: "",
      timedOut: false,
    });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });
    const { detail } = outcome as { detail: string };
    expect(detail).toContain("ssh build-box");
    expect(detail).toContain("Host key verification failed.");
    expect(detail).not.toContain("authorized_keys");
  });

  it("a machine that took this build through its own update channel already carries it", async () => {
    // Its HMR layer wrote harness.json itself on commit — its own pushedAt, its own spacing —
    // around the same content-named files. Read as text, that is a different build, and every
    // install would hand the same build over again.
    const theirs = JSON.stringify(
      {
        platform: { bundle: "store/platform/cafe0123456789ab.mjs" },
        pushedAt: "2026-10-10T00:00:00Z",
      },
      null,
      2,
    ).replaceAll("\n", "\\n");
    const channel = scripted({
      probe: `Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n${theirs}`,
    });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });
    expect(outcome).toMatchObject({ kind: "already-installed" });
  });

  it("keeps curl's progress bar out of the log and quotes the installer's error as the failure", async () => {
    const channel = scripted({
      probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n",
      installSays: [
        "Downloading penguin-linux-x64.tar.gz from GitHub ...",
        "##########                    14.2%\r######################### 100.0%",
        "error: download failed from both the primary source and its fallback. Check your network, then retry.",
      ],
      installExit: 1,
    });
    const progress: string[] = [];
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
      onProgress: (line) => progress.push(line),
    });
    expect(progress.some((line) => line.includes("%"))).toBe(false);
    expect(progress).toContain("Downloading penguin-linux-x64.tar.gz from GitHub ...");
    expect(outcome).toMatchObject({
      kind: "failed",
      step: "install",
      detail:
        "error: download failed from both the primary source and its fallback. Check your network, then retry.",
    });
  });

  it("leads with the program's own error when the installer points above itself", async () => {
    const channel = scripted({
      probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n",
      installSays: [
        "Bundle checksum OK.",
        "node: /lib64/libc.so.6: version `GLIBC_2.28' not found (required by node)",
        "error: candidate PenguinHarness failed to run (exit status 1). See the error above.",
      ],
      installExit: 1,
    });
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      channel,
      layout: RELEASE,
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    const said = outcome.detail.split("\n");
    expect(said.at(-2)).toBe(
      "node: /lib64/libc.so.6: version `GLIBC_2.28' not found (required by node)",
    );
    expect(said.at(-1)).toBe(
      "error: candidate PenguinHarness failed to run (exit status 1). See the error above.",
    );
  });

  it("refuses a base that cannot name a release", async () => {
    const channel = scripted({
      probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n",
      afterInstall: 'Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n',
    });
    const outcome = await installOnRemote({
      target,
      layout: RELEASE,
      plan: plan({ baseVersion: "0.0.0-hmr.cafe", version: "0.0.0-hmr.cafe" }),
      assets,
      channel,
    });
    expect(outcome).toMatchObject({ kind: "failed", step: "resolve the release" });
  });
});
