/**
 * The connection check (machines/diagnose.ts, `MachinesService.diagnose`): what would stop an
 * install or a connect on a machine, asked over ssh with nothing written there.
 *
 * The machine is faked at the transport's edge — `runOn`, the one command channel — answering
 * the probe and the check command the way a machine's shell does. One case runs the real check
 * command in a local `sh`, because its shell text is what every machine runs.
 *
 * Scenarios:
 * - Given a Linux machine that has everything, every check passes and names who signed in.
 * - Given a host whose key this computer has never seen, the ssh check fails with that reason,
 *   every other check is skipped, and no second command is sent.
 * - Given a machine without curl, the tools check names it as a caveat (the release is carried
 *   over ssh) and the download is not asked; without tar it fails.
 * - Given a machine that reaches neither GitHub nor the mirror, the download is a warning;
 *   given both answering without the release, it fails (not published).
 * - Given too little room in its home, the disk check fails; given room for one install but
 *   not two, it warns.
 * - Given the port taken by another program it fails; held by its own server it passes.
 * - Given a Linux machine whose glibc is older than the release's Node needs, the platform check
 *   fails naming both versions; given a musl system (Alpine), it fails as musl.
 * - Given a Windows machine, it is installable but the POSIX checks are skipped.
 * - Given a job working on the machine, the check is refused rather than queued behind it.
 * - The release sources it asks are the installer's own.
 * - The check command runs in a real POSIX shell and reports a free port and the tools.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { MachineCheck } from "../src/api/types.js";
import { openDatabase } from "../src/db/database.js";
import { MachinesRepo } from "../src/db/repos/machines.js";
import { MachinesService } from "../src/machines/service.js";
import type { MachinesEffects } from "../src/machines/service.js";
import { remoteLayoutFor } from "../src/machines/layout.js";
import {
  INSTALL_NEEDS_MB,
  MIN_GLIBC,
  RELEASE_SOURCES,
  diagnoseCommand,
  parseDiagnosis,
} from "../src/machines/diagnose.js";
import type { ExecResult } from "../src/machines/transport/index.js";
import { makeTempRoot, waitFor } from "./helpers.js";

const DEV = remoteLayoutFor("dev");
const LINUX_PROBE = "Linux x86_64\n---penguin---\n---penguin---\n";
const said = (stdout: string, code = 0): ExecResult => ({
  code,
  stdout,
  stderr: "",
  timedOut: false,
});

/** A check command's answer: everything in place unless a test says otherwise. */
function answer(
  over: Partial<
    Record<"missing" | "disk" | "libc" | "oss" | "github" | "lock" | "port", string>
  > = {},
) {
  const lines = ["@@who penguin box-1"];
  if (over.missing !== undefined)
    lines.push(...over.missing.split(" ").map((t) => `@@missing ${t}`));
  lines.push(`@@disk ${over.disk ?? String(50 * 1024 * 1024)}`);
  lines.push(`@@libc ${over.libc ?? "ldd (Debian GLIBC 2.36-9+deb12u4) 2.36"}`);
  lines.push(`@@oss ${over.oss ?? "206 0"}`, `@@github ${over.github ?? "206 0"}`);
  if (over.lock !== undefined) lines.push(`@@lock ${over.lock}`);
  lines.push(`@@port ${over.port ?? "000 7"}`);
  return lines.join("\n") + "\n";
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A service whose machine answers through `runOn`; the commands it was sent are returned. */
async function serviceFor(
  runOn: (command: string) => ExecResult,
  over: Partial<MachinesEffects> = {},
) {
  const root = await makeTempRoot();
  roots.push(root);
  const sent: string[] = [];
  const service = new MachinesService(
    root,
    "TESTlocalID00000",
    new MachinesRepo(openDatabase(":memory:")),
    {
      listAliases: () => ["box"],
      resolvePlan: () => ({
        baseVersion: "0.2.13",
        harness: null,
        hmrDir: null,
        version: "0.2.13",
      }),
      now: () => new Date("2026-10-10T12:00:00.000Z"),
      runOn: async (_target, command) => {
        sent.push(command);
        return runOn(command);
      },
      ...over,
    },
    undefined,
    DEV,
  );
  return { service, sent };
}

/** The checks of a diagnosis by id, for reading one at a time. */
async function checksOf(
  runOn: (command: string) => ExecResult,
  over: Partial<MachinesEffects> = {},
) {
  const { service, sent } = await serviceFor(runOn, over);
  const result = await service.diagnose("ssh:box");
  if (typeof result === "string") throw new Error(`refused: ${result}`);
  const byId = Object.fromEntries(result.checks.map((check) => [check.id, check])) as Record<
    MachineCheck["id"],
    MachineCheck
  >;
  return { byId, sent, result };
}

describe("the connection check", () => {
  it("passes every check on a Linux machine that has everything, naming who signed in", async () => {
    const { byId, result } = await checksOf((command) =>
      command.includes("@@who") ? said(answer()) : said(LINUX_PROBE),
    );
    expect(result.checks.map((check) => `${check.id}:${check.state}`)).toEqual([
      "ssh:pass",
      "platform:pass",
      "tools:pass",
      "download:pass",
      "disk:pass",
      "port:pass",
    ]);
    expect(byId.ssh).toMatchObject({ user: "penguin", host: "box-1" });
    expect(byId.platform).toMatchObject({ os: "linux", arch: "x64" });
    expect(byId.port).toMatchObject({ port: DEV.defaultPort, holder: "free" });
  });

  it("fails ssh with its reason when the host key is unknown, skips the rest, and sends nothing more", async () => {
    const { byId, sent, result } = await checksOf(() =>
      said(
        "This computer has never connected to box, and connections here cannot answer ssh's question about a new host key. (ssh: Host key verification failed.)",
        255,
      ),
    );
    expect(byId.ssh).toMatchObject({ state: "fail", reason: "host-key-unknown" });
    expect(result.checks.slice(1).every((check) => check.state === "skip")).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("names a missing curl as a caveat and does not ask about the download; a missing tar fails", async () => {
    const { byId } = await checksOf((command) =>
      command.includes("@@who") ? said(answer({ missing: "curl" })) : said(LINUX_PROBE),
    );
    expect(byId.tools).toMatchObject({ state: "warn", missing: ["curl"] });
    expect(byId.download.state).toBe("skip");
    const noTar = await checksOf((command) =>
      command.includes("@@who") ? said(answer({ missing: "tar" })) : said(LINUX_PROBE),
    );
    expect(noTar.byId.tools).toMatchObject({ state: "fail", missing: ["tar"] });
  });

  it("warns when neither source is in reach, and fails when both answer without the release", async () => {
    const out = await checksOf((command) =>
      command.includes("@@who")
        ? said(answer({ oss: "000 28", github: "000 7" }))
        : said(LINUX_PROBE),
    );
    expect(out.byId.download).toMatchObject({
      state: "warn",
      version: "0.2.13",
      oss: "unreachable",
      github: "unreachable",
    });
    const missing = await checksOf((command) =>
      command.includes("@@who")
        ? said(answer({ oss: "404 0", github: "404 0" }))
        : said(LINUX_PROBE),
    );
    expect(missing.byId.download).toMatchObject({
      state: "fail",
      oss: "missing",
      github: "missing",
    });
  });

  it("fails the disk below what an install needs, and warns with room for one install only", async () => {
    const low = await checksOf((command) =>
      command.includes("@@who") ? said(answer({ disk: String(100 * 1024) })) : said(LINUX_PROBE),
    );
    expect(low.byId.disk).toMatchObject({ state: "fail", freeMb: 100, needMb: INSTALL_NEEDS_MB });
    const tight = await checksOf((command) =>
      command.includes("@@who")
        ? said(answer({ disk: String((INSTALL_NEEDS_MB + 10) * 1024) }))
        : said(LINUX_PROBE),
    );
    expect(tight.byId.disk.state).toBe("warn");
  });

  it("fails a port another program holds, and passes the one its own server holds", async () => {
    const taken = await checksOf((command) =>
      command.includes("@@who") ? said(answer({ port: "404 0" })) : said(LINUX_PROBE),
    );
    expect(taken.byId.port).toMatchObject({ state: "fail", holder: "other" });
    const ours = await checksOf((command) =>
      command.includes("@@who")
        ? said(answer({ port: "401 0", lock: String(DEV.defaultPort) }))
        : said(LINUX_PROBE),
    );
    expect(ours.byId.port).toMatchObject({ state: "pass", holder: "penguin" });
  });

  it("fails a glibc older than the release's Node needs, naming both, and a musl system", async () => {
    const old = await checksOf((command) =>
      command.includes("@@who") ? said(answer({ libc: "ldd (GNU libc) 2.17" })) : said(LINUX_PROBE),
    );
    expect(old.byId.platform).toMatchObject({
      state: "fail",
      reason: "glibc",
      glibc: "2.17",
      need: MIN_GLIBC,
    });
    const alpine = await checksOf((command) =>
      command.includes("@@who") ? said(answer({ libc: "musl libc (x86_64)" })) : said(LINUX_PROBE),
    );
    expect(alpine.byId.platform).toMatchObject({ state: "fail", reason: "musl" });
    const ubuntu = await checksOf((command) =>
      command.includes("@@who")
        ? said(answer({ libc: "ldd (Ubuntu GLIBC 2.35-0ubuntu3.8) 2.35" }))
        : said(LINUX_PROBE),
    );
    expect(ubuntu.byId.platform.state).toBe("pass");
  });

  it("says a Windows machine is installable and skips the POSIX checks", async () => {
    const { byId, sent } = await checksOf(
      () => said("the connection to this machine ended: 'sh' is not recognized", 255),
      {
        detect: async () => ({
          identity: { platform: "win32", arch: "x64", installedVersion: null, harness: null },
        }),
      },
    );
    expect(byId.ssh.state).toBe("pass");
    expect(byId.platform).toMatchObject({ state: "warn", os: "win32" });
    expect(
      ["tools", "download", "disk", "port"].map((id) => byId[id as MachineCheck["id"]].state),
    ).toEqual(["skip", "skip", "skip", "skip"]);
    expect(sent).toHaveLength(1);
  });

  it("refuses while a job works on the machine instead of queueing behind it", async () => {
    const install: { release?: () => void } = {};
    const { service } = await serviceFor(() => said(LINUX_PROBE), {
      install: () =>
        new Promise((resolve) => {
          install.release = () => resolve({ kind: "failed", step: "install", detail: "stopped" });
        }),
    });
    await service.startInstall("default_project", "ssh:box");
    await waitFor(() => install.release !== undefined);
    expect(await service.diagnose("ssh:box")).toBe("busy");
    install.release?.();
    await waitFor(() => service.jobs().every((job) => !job.running));
  });

  it("asks the sources the installer downloads from", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = fs.readFileSync(path.join(here, "..", "..", "..", "install.sh"), "utf8");
    const vars = new Map<string, string>();
    for (const match of script.matchAll(/^(\w+)="([^"]*)"$/gm)) {
      vars.set(
        match[1]!,
        match[2]!.replace(/\$(\w+)/g, (_, name: string) => vars.get(name) ?? ""),
      );
    }
    expect(RELEASE_SOURCES).toEqual({
      oss: vars.get("OSS_RELEASE_ROOT"),
      github: vars.get("GITHUB_RELEASE_ROOT"),
    });
  });

  it.skipIf(process.platform === "win32")(
    "runs in a real POSIX shell, and reads a free port and the tools from it",
    async () => {
      const home = await makeTempRoot();
      roots.push(home);
      const port = await new Promise<number>((resolve) => {
        const probe = net.createServer().listen(0, "127.0.0.1", () => {
          const { port: free } = probe.address() as net.AddressInfo;
          probe.close(() => resolve(free));
        });
      });
      const output = await new Promise<string>((resolve) => {
        execFile(
          "sh",
          ["-c", diagnoseCommand(DEV, null, port)],
          { env: { ...process.env, HOME: home } },
          (_error, stdout) => resolve(String(stdout)),
        );
      });
      const checks = parseDiagnosis(
        {
          platform: os.platform() === "darwin" ? "darwin" : "linux",
          arch: "x64",
          installedVersion: null,
          harness: null,
        },
        output,
        { version: null, port },
      );
      const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
      expect(byId.ssh).toMatchObject({ state: "pass", user: os.userInfo().username });
      // CI's Linux and macOS both run the release's Node, so the libc this shell reports passes.
      expect(byId.platform?.state).toBe("pass");
      expect(byId.download?.state).toBe("skip");
      expect(byId.disk?.state).not.toBe("skip");
      // CI images have curl; the check is that the port answer parses, not which tools exist.
      if (!output.includes("@@missing curl")) {
        expect(byId.port).toMatchObject({ state: "pass", holder: "free", port });
      }
    },
  );
});
