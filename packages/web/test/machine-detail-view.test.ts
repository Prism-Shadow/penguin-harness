/**
 * What the Machine dialog says about a machine (features/machines/machine-detail-view.ts).
 *
 * - The status chip says every state in that state's own word, in the tone the card's mark
 *   wears, with a spinner only while the machine is working; the reason behind the word is there
 *   exactly when there is one — a failure's words after its step by the name the steps list gives
 *   it, ssh's diagnostic, the line a working job is on, the version a machine on another build
 *   would get (none when this server has no build of its own). This server's own entry is running.
 * - The one thing to do: nothing while a job is on its way; Retry after a failure, even on another
 *   build; Enable for a machine added with nothing installed yet; Update for a machine on another
 *   build, connected or not, naming the version; nothing
 *   for a ready machine or one installed as far as it goes; Start server for a stopped server,
 *   connected or not; Connect for a machine not connected or never checked; Try again for one out
 *   of reach.
 * - A job's steps: a queued job has every step still to come; a running one is on its phase with
 *   the earlier steps done; one that finished well is a single line; a failed one is marked
 *   failed at its phase, named in words, with the far side's own words — and a step the server
 *   names outside the pipeline is told as it was named. One that ssh refused before it named a
 *   phase is marked failed at the step its failure names, and says why in the page's language
 *   with ssh's own words under it.
 * - A verb is held for the first reason that applies: a request in flight holds every verb; a job
 *   on its way holds the single steps but never the ways out or the ssh form; no build holds
 *   Install; nothing installed holds Reconnect and Restart; a check already running holds Check
 *   connection; nothing connected holds Disconnect; a machine out of reach holds Restart alone. The
 *   reason a row tells leaves the request in flight out — it holds every verb for a moment — and
 *   still tells the machine's own.
 * - The installed version says whether it is the one this server would install, and is bare when
 *   there is nothing to compare it against or it is this server's own.
 * - The facts: a remote machine is reached over ssh, with the address its alias names once the
 *   host block is read — said the way ssh would be told it — the server over there in words with
 *   ssh's own words under them, the last check measured from now with the time itself beside it,
 *   the build against this server's, and its id last; a check a week old or more is the time
 *   alone, and a stamp that cannot be read has no time beside it; one never checked has no
 *   server or last-check row, and one with nothing installed no build rows. This server's own
 *   entry is reached here, without ssh, and says its version and when it started.
 * - The connection check says each check in a plain sentence: who signed in, the system, what
 *   the installer lacks (curl alone a caveat: the release is carried), whether the machine
 *   reaches the release (or is sent it), the room left, and who holds the port; a sign-in that
 *   failed says what to do, with ssh's own words under it; a check not asked says which.
 */
import { describe, expect, it } from "vitest";
import type { MachineCheck, MachineInfo, MachineJob } from "@prismshadow/penguin-server/api";
import {
  checkLine,
  holdReason,
  installedText,
  jobSteps,
  jobView,
  machineChip,
  machineFacts,
  primaryAction,
  verbGroups,
  verbHold,
} from "../src/features/machines/machine-detail-view";
import type { DialogVerb, Fact, VerbContext } from "../src/features/machines/machine-detail-view";
import { readingTone } from "../src/features/machines/machines-view";
import type { MachineReading } from "../src/features/machines/machines-view";
import { formatDateTime, formatShortDateTime } from "../src/lib/format";
import { S } from "../src/lib/strings";

const IMAGE = "0.2.13";

const failed: Extract<MachineReading, { kind: "failed" }> = {
  kind: "failed",
  step: "restart",
  message: "No answer on port 7364 within 30 s.",
  canReplaceProgram: true,
};
const unreachable: Extract<MachineReading, { kind: "unreachable" }> = {
  kind: "unreachable",
  detail: "ssh: connect to host 10.0.0.12 port 22: Connection timed out",
};
const working: Extract<MachineReading, { kind: "working" }> = {
  kind: "working",
  step: "Downloading penguin-harness 0.2.13…",
};
const ready: MachineReading = { kind: "ready", port: 7364 };

/** Every reading a remote machine can have. */
const READINGS: MachineReading[] = [
  { kind: "queued" },
  working,
  failed,
  ready,
  { kind: "linkedStopped" },
  { kind: "installedOnly" },
  { kind: "behind", version: "0.2.12" },
  { kind: "notConnected" },
  unreachable,
  { kind: "stopped" },
  { kind: "notInstalled" },
  { kind: "unknown" },
];

describe("the status chip", () => {
  it.each(
    READINGS.map((reading): [MachineReading["kind"], MachineReading] => [reading.kind, reading]),
  )(
    "%s: says the state in its own word, in the card's tone, with a reason only when there is one",
    (kind, reading) => {
      const chip = machineChip(reading, IMAGE);
      expect(chip.word).toBe(S.machines.state[kind]);
      expect(chip.tone).toBe(readingTone(reading));
      // A spinner stands in for the glyph while the machine is working, and only then.
      expect(chip.glyph === null).toBe(kind === "working");
      expect(chip.reason !== null).toBe(
        ["failed", "unreachable", "working", "behind"].includes(kind),
      );
    },
  );

  it("gives the far side's own words as the reason, and for another build the version on offer", () => {
    expect(machineChip(failed, IMAGE).reason).toContain(failed.message);
    // The step a failure stopped at goes by the name the steps list gives it; a step the server
    // names outside the pipeline, as the server named it.
    expect(machineChip(failed, IMAGE).reason).toContain(S.machines.step.restart);
    expect(machineChip({ ...failed, step: "ssh" }, IMAGE).reason).toContain("ssh");
    expect(machineChip(unreachable, IMAGE).reason).toBe(unreachable.detail);
    expect(machineChip(working, IMAGE).reason).toBe(working.step);
    expect(machineChip({ kind: "behind", version: "0.2.12" }, IMAGE).reason).toContain(IMAGE);
    // With no build of its own, this server has no version to offer.
    expect(machineChip({ kind: "behind", version: "0.2.12" }, null).reason).toBeNull();
  });

  it("says this server's own entry is running, with nothing behind the word", () => {
    const chip = machineChip(null, IMAGE);
    expect(chip).toMatchObject({ word: S.machines.state.serving, tone: "link", reason: null });
    expect(chip.glyph).not.toBeNull();
  });
});

describe("the one thing to do", () => {
  const kindOf = (reading: MachineReading, outOfDate = false) =>
    primaryAction(reading, outOfDate, IMAGE)?.kind ?? null;

  it("is nothing while a job is on its way, even for a machine on another build", () => {
    expect(kindOf({ kind: "queued" }, true)).toBeNull();
    expect(kindOf(working, true)).toBeNull();
  });

  it("is Retry after a failure, even on another build", () => {
    expect(kindOf(failed, true)).toBe("retry");
  });

  it("is Update for a machine on another build, connected or not, naming the version it brings", () => {
    expect(kindOf(ready, true)).toBe("update");
    expect(kindOf({ kind: "notConnected" }, true)).toBe("update");
    expect(kindOf({ kind: "behind", version: "0.2.12" }, true)).toBe("update");
    expect(primaryAction(ready, true, IMAGE)!.why).toContain(IMAGE);
  });

  it("is nothing for a ready machine, or one installed as far as it goes", () => {
    expect(kindOf(ready)).toBeNull();
    expect(kindOf({ kind: "installedOnly" })).toBeNull();
  });

  it("starts a stopped server, connected or not", () => {
    expect(kindOf({ kind: "stopped" })).toBe("start");
    expect(kindOf({ kind: "linkedStopped" })).toBe("start");
  });

  it("enables a machine added with nothing installed yet, and offers no separate Reconnect beside it", () => {
    expect(kindOf({ kind: "notInstalled" })).toBe("enable");
    const maintenance = verbGroups("enable")[0]!.rows.map((row) => row.verb);
    expect(maintenance).not.toContain("connect");
    expect(maintenance).toContain("check");
  });

  it("connects a machine not connected or never checked, and tries one out of reach again", () => {
    expect(kindOf({ kind: "notConnected" })).toBe("connect");
    expect(kindOf({ kind: "unknown" })).toBe("connect");
    expect(kindOf(unreachable)).toBe("tryAgain");
  });
});

describe("a job's steps", () => {
  const job = (over: Partial<MachineJob>): MachineJob => ({
    kind: "use",
    machineId: "ssh:nas",
    alias: "nas",
    queued: false,
    running: false,
    phase: null,
    log: [],
    result: null,
    ...over,
  });
  const states = (of: MachineJob) => jobSteps(of).map((step) => step.state);

  it("are all still to come while the job is queued", () => {
    const queued = job({ queued: true });
    expect(jobView(queued).kind).toBe("queued");
    expect(states(queued)).toEqual(Array(6).fill("pending"));
  });

  it("are done up to the phase a running job is on, which is current, and still to come after it", () => {
    const running = job({ running: true, phase: "install" });
    expect(jobView(running).kind).toBe("running");
    expect(states(running)).toEqual([
      "done",
      "current",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("fold into a single line once the job finished well", () => {
    expect(jobView(job({ phase: "sync", result: { ok: true, connected: true } }))).toEqual({
      kind: "done",
    });
    expect(states(job({ phase: "sync", result: { ok: true, connected: true } }))).toEqual(
      Array(6).fill("done"),
    );
  });

  it("mark a failed job at its phase, named in words, with the far side's own words", () => {
    const stopped = job({
      phase: "restart",
      result: { ok: false, step: "restart", message: failed.message, canReplaceProgram: true },
    });
    expect(jobView(stopped)).toMatchObject({
      kind: "failed",
      stepName: S.machines.step.restart,
      message: failed.message,
      detail: null,
      canReplaceProgram: true,
    });
    expect(states(stopped)).toEqual(["done", "done", "done", "failed", "pending", "pending"]);
  });

  it("mark a job ssh refused before it named a phase failed at the step it names, saying why in the page's language", () => {
    const said =
      "nas did not accept any key this computer offered. (ssh: penguin@nas: Permission denied (publickey).)";
    const refused = job({
      result: {
        ok: false,
        step: "check",
        message: said,
        canReplaceProgram: false,
        sshReason: "auth",
      },
    });
    expect(states(refused)).toEqual([
      "failed",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(jobView(refused)).toMatchObject({
      kind: "failed",
      stepName: S.machines.step.check,
      message: S.machines.check.ssh.auth("nas"),
      detail: S.machines.check.sshSaid("penguin@nas: Permission denied (publickey)."),
      canReplaceProgram: false,
    });
  });

  it("tell a failed step the server names outside the pipeline as it was named", () => {
    const refused = job({
      phase: "check",
      result: { ok: false, step: "ssh", message: "Permission denied (publickey)." },
    });
    expect(jobView(refused)).toMatchObject({
      kind: "failed",
      stepName: "ssh",
      canReplaceProgram: false,
    });
  });
});

describe("a held verb", () => {
  const idle: VerbContext = {
    busy: false,
    moving: false,
    noImage: false,
    connected: true,
    unreachable: false,
    installed: true,
    checking: false,
  };
  const VERBS: DialogVerb[] = [
    "install",
    "connect",
    "restart",
    "check",
    "configure",
    "stopUsing",
    "disconnect",
    "release",
  ];
  const held = (ctx: VerbContext) => VERBS.filter((verb) => verbHold(verb, ctx) !== null);

  it("is none on an idle, connected machine", () => {
    expect(held(idle)).toEqual([]);
  });

  it("is every verb while a request is in flight, which is the reason given before any other", () => {
    const everything = {
      busy: true,
      moving: true,
      noImage: true,
      connected: false,
      unreachable: true,
      installed: false,
      checking: true,
    };
    for (const verb of VERBS) expect(verbHold(verb, everything), verb).toBe("busy");
  });

  it("is each single step while a job is on its way, never a way out or the ssh form", () => {
    const moving = { ...idle, moving: true, noImage: true, unreachable: true };
    expect(held(moving)).toEqual(["install", "connect", "restart", "check"]);
    for (const verb of ["install", "connect", "restart", "check"] as const) {
      expect(verbHold(verb, moving), verb).toBe("moving");
    }
  });

  it("is Install with no build to push, Disconnect with nothing connected, and Restart alone for a machine out of reach", () => {
    expect(held({ ...idle, noImage: true })).toEqual(["install"]);
    expect(verbHold("install", { ...idle, noImage: true })).toBe("noImage");
    expect(held({ ...idle, connected: false })).toEqual(["disconnect"]);
    expect(verbHold("disconnect", { ...idle, connected: false })).toBe("noConnection");
    expect(held({ ...idle, unreachable: true })).toEqual(["restart"]);
    expect(verbHold("restart", { ...idle, unreachable: true })).toBe("unreachable");
  });

  it("is Reconnect and Restart on a machine with nothing installed, and Check connection while one runs", () => {
    expect(held({ ...idle, installed: false })).toEqual(["connect", "restart"]);
    expect(verbHold("connect", { ...idle, installed: false })).toBe("notInstalled");
    expect(held({ ...idle, checking: true })).toEqual(["check"]);
    expect(verbHold("check", { ...idle, checking: true })).toBe("checking");
  });

  it("tells in its row the machine's own reason, never the request in flight, which holds every verb for a moment", () => {
    const busy = { ...idle, busy: true };
    for (const verb of VERBS) expect(holdReason(verb, busy), verb).toBeNull();
    const waiting = { ...busy, moving: true, connected: false };
    expect(VERBS.map((verb) => holdReason(verb, waiting))).toEqual([
      "moving",
      "moving",
      "moving",
      "moving",
      null,
      null,
      "noConnection",
      null,
    ]);
  });
});

describe("the installed version", () => {
  it("says whether it is the one this server would install", () => {
    expect(installedText({ version: IMAGE }, IMAGE, false)).toEqual({
      version: IMAGE,
      note: "latest",
    });
    expect(installedText({ version: "0.2.12" }, IMAGE, false)).toEqual({
      version: "0.2.12",
      note: "behind",
    });
  });

  it("is bare with nothing to compare it against, and for this server's own", () => {
    expect(installedText({ version: "0.2.12" }, null, false)).toEqual({
      version: "0.2.12",
      note: null,
    });
    expect(installedText({ version: IMAGE }, "0.2.14", true)).toEqual({
      version: IMAGE,
      note: null,
    });
    expect(installedText(null, IMAGE, false)).toEqual({ version: "", note: null });
  });
});

describe("the facts", () => {
  const NOW = Date.parse("2026-10-10T08:00:00.000Z");
  const edge: MachineInfo = {
    id: "ssh:edge-1",
    alias: "edge-1",
    installed: { version: "0.2.12", at: "2026-10-01T08:00:00.000Z" },
    machineId: "Ed5tN1qRz8Kc3VwY",
    local: false,
    connection: null,
    api: null,
    status: {
      state: "unreachable",
      checkedAt: "2026-10-10T07:57:00.000Z",
      detail: unreachable.detail!,
    },
    root: "/home/ubuntu/.penguin/data",
  };
  const block = {
    alias: "edge-1",
    hostName: "10.0.0.12",
    user: "ubuntu",
    port: 2222,
    editable: true,
  };
  const byKey = (facts: { left: Fact[]; right: Fact[] }) =>
    new Map([...facts.left, ...facts.right].map((fact) => [fact.key, fact]));

  it("of a remote machine: reached over ssh at its address, the server in words, the last check from now, the build against this server's, the id last", () => {
    const facts = machineFacts(edge, block, IMAGE, "en", NOW);
    expect(facts.left.map((fact) => fact.key)).toEqual(["connection", "host", "root"]);
    expect(facts.right.map((fact) => fact.key)).toEqual([
      "service",
      "checked",
      "installed",
      "installedAt",
    ]);
    const fact = byKey(facts);
    expect(fact.get("connection")!.value).toContain(edge.alias);
    expect(fact.get("host")!.value).toBe("ubuntu@10.0.0.12:2222");
    expect(fact.get("root")!.value).toBe(edge.root);
    // A plain word, with ssh's own words under it.
    expect(fact.get("service")).toMatchObject({
      value: S.machines.detail.fact.unreachable,
      note: unreachable.detail,
    });
    // How long ago, and the time itself beside it.
    expect(fact.get("checked")).toMatchObject({
      value: "3 minutes ago",
      aside: formatShortDateTime(edge.status!.checkedAt),
    });
    expect(fact.get("installed")!.value).toBe(S.machines.detail.fact.behind("0.2.12", IMAGE));
    expect(facts.id).toMatchObject({ value: edge.machineId, quiet: true });
  });

  it("say a check a week old or more as the time alone, never the time twice, and put nothing beside a stamp they cannot read", () => {
    const checked = (checkedAt: string) =>
      byKey(
        machineFacts({ ...edge, status: { state: "stopped", checkedAt } }, null, IMAGE, "en", NOW),
      ).get("checked")!;
    const old = checked("2026-10-01T08:00:00.000Z");
    expect(old.value).toBe(formatDateTime("2026-10-01T08:00:00.000Z"));
    expect(old.aside).toBeUndefined();
    expect(checked("not-a-date").aside).toBeUndefined();
  });

  it("name no address until the host block is read, no server or last check before a first probe, and no build where none is installed", () => {
    const fresh = byKey(machineFacts({ ...edge, status: null }, null, IMAGE, "zh", NOW));
    expect([...fresh.keys()]).toEqual(["connection", "root", "installed", "installedAt"]);
    const bare = byKey(machineFacts({ ...edge, installed: null }, null, IMAGE, "zh", NOW));
    expect([...bare.keys()]).toEqual(["connection", "root", "service", "checked"]);
    expect(machineFacts({ ...edge, machineId: null }, null, IMAGE, "zh", NOW).id).toBeNull();
  });

  it("say the address the way ssh would be told it: the default port and an absent user unsaid", () => {
    const address = (over: Partial<typeof block>) =>
      byKey(machineFacts(edge, { ...block, ...over }, IMAGE, "en", NOW)).get("host")!.value;
    expect(address({ port: 22 })).toBe("ubuntu@10.0.0.12");
    expect(address({ user: "", port: undefined })).toBe("10.0.0.12");
  });

  it("of this server's own entry: reached here without ssh, its server, its version and when it started", () => {
    const here: MachineInfo = {
      ...edge,
      id: "local",
      alias: "penguin-dev",
      local: true,
      installed: { version: IMAGE, at: "2026-10-07T08:00:00.000Z" },
      status: { state: "running", checkedAt: "2026-10-10T08:00:00.000Z", port: 7364 },
    };
    const facts = machineFacts(here, block, "0.2.14", "zh", NOW);
    // Never an address: this server reaches itself without ssh.
    expect(facts.left.map((fact) => fact.key)).toEqual(["connection", "root"]);
    const fact = byKey(facts);
    expect(fact.get("connection")!.value).toBe(S.machines.detail.fact.local);
    expect(fact.get("service")).toMatchObject({
      label: S.machines.detail.fact.serviceLocal,
      value: S.machines.detail.fact.running(7364),
    });
    // Its own build is bare: it is the build, not behind one.
    expect(fact.get("installed")).toMatchObject({
      label: S.machines.detail.fact.version,
      value: IMAGE,
    });
    expect(fact.get("installedAt")!.label).toBe(S.machines.detail.fact.started);
  });

  it("say a stopped server is not running, one out of reach with no words of ssh's is just that, and one running on no known port is running", () => {
    const service = (status: NonNullable<MachineInfo["status"]>) =>
      byKey(machineFacts({ ...edge, status }, null, IMAGE, "en", NOW)).get("service")!;
    const checkedAt = edge.status!.checkedAt;
    const stopped = service({ state: "stopped", checkedAt });
    expect(stopped.value).toBe(S.machines.detail.fact.stopped);
    expect(stopped.note).toBeUndefined();
    const away = service({ state: "unreachable", checkedAt });
    expect(away.value).toBe(S.machines.detail.fact.unreachable);
    expect(away.note).toBeUndefined();
    expect(service({ state: "running", checkedAt }).value).toBe(S.machines.state.serving);
  });
});

describe("the connection check", () => {
  const line = (check: MachineCheck) => checkLine(check, "gpu-1");

  it("says who signed in and the system, and a passing check wears the check mark", () => {
    const ssh = line({ id: "ssh", state: "pass", user: "ubuntu", host: "gpu-1.lan" });
    expect(ssh.text).toBe(S.machines.check.sshPass("ubuntu", "gpu-1.lan"));
    expect(ssh).toMatchObject({ tone: "success", detail: null });
    expect(line({ id: "platform", state: "pass", os: "darwin", arch: "arm64" }).text).toBe(
      S.machines.check.platform("macOS", "arm64"),
    );
  });

  it("says what to do about a sign-in ssh refused, with ssh's own words under it and only the mark in danger", () => {
    const refused = line({
      id: "ssh",
      state: "fail",
      reason: "host-key-unknown",
      said: "This computer has never connected to gpu-1… (ssh: Host key verification failed.)",
    });
    expect(refused.text).toBe(S.machines.check.ssh["host-key-unknown"]("gpu-1"));
    expect(refused.detail).toBe(S.machines.check.sshSaid("Host key verification failed."));
    expect(refused.tone).toBe("danger");
  });

  it("calls a missing curl a caveat — the release is carried — and a machine that reaches no source one too", () => {
    expect(line({ id: "tools", state: "warn", missing: ["curl"] })).toMatchObject({
      text: S.machines.check.toolsNoCurl,
      tone: "attention",
    });
    expect(
      line({
        id: "download",
        state: "warn",
        version: "0.2.13",
        github: "unreachable",
        oss: "unreachable",
      }).text,
    ).toBe(S.machines.check.downloadCarried("0.2.13"));
    expect(
      line({ id: "download", state: "pass", version: "0.2.13", github: "unreachable", oss: "ok" })
        .text,
    ).toBe(S.machines.check.downloadFrom("0.2.13", "oss"));
  });

  it("names the glibc a machine has against the one the release needs, a musl system, and terminals that will not open", () => {
    const old = line({
      id: "platform",
      state: "fail",
      reason: "glibc",
      os: "linux",
      arch: "x64",
      glibc: "2.17",
      need: "2.28",
    });
    expect(old).toMatchObject({
      text: S.machines.check.platformOldGlibc("2.17", "2.28"),
      tone: "danger",
      detail: null,
    });
    expect(
      line({ id: "platform", state: "fail", reason: "musl", os: "linux", arch: "arm64" }).text,
    ).toBe(S.machines.check.platformMusl);
    expect(
      line({
        id: "platform",
        state: "warn",
        os: "linux",
        arch: "x64",
        glibc: "2.31",
        terminalsNeed: "2.34",
      }),
    ).toMatchObject({
      text: S.machines.check.platformTerminals("x64", "2.31", "2.34"),
      tone: "attention",
    });
    expect(
      line({ id: "platform", state: "fail", reason: "unsupported", said: "FreeBSD amd64" }),
    ).toMatchObject({ text: S.machines.check.platformUnsupported, detail: "FreeBSD amd64" });
  });

  it("names the room left against what an install needs, and who holds the port", () => {
    expect(line({ id: "disk", state: "fail", freeMb: 300, needMb: 800 }).text).toBe(
      S.machines.check.diskLow("300MB", "800MB"),
    );
    expect(line({ id: "port", state: "fail", port: 7371, holder: "other" }).text).toBe(
      S.machines.check.portTaken(7371),
    );
    expect(line({ id: "port", state: "pass", port: 7371, holder: "penguin" }).text).toBe(
      S.machines.check.portOurs(7371),
    );
    expect(line({ id: "disk", state: "skip" })).toMatchObject({
      glyph: null,
      tone: "muted",
      text: S.machines.check.skipped(S.machines.check.name.disk),
    });
  });
});
