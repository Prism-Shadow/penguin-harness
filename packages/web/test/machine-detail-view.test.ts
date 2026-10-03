/**
 * What the Machine dialog says about a machine (features/machines/machine-detail-view.ts).
 *
 * - The status chip says every state in that state's own word, in the tone the card's mark
 *   wears, with a spinner only while the machine is working or being brought back; the reason
 *   behind the word is there exactly when there is one — a failure's words after its step by the
 *   name the steps list gives it, ssh's diagnostic, the line a working job is on, the attempt a
 *   reconnect failed at, the failure a stopped reconnect ended on, the version a machine on another
 *   build would get (none when this server has no build of its own), and for a machine whose
 *   server needs a restart why it does. This server's own entry is running.
 * - The toolbar: one row, no verb twice. A machine with nothing installed is enabled; one on
 *   another build is updated, and only then — in sync, there is no update to offer, hidden rather
 *   than greyed; then its server is stopped while it is kept connected, started once it is not;
 *   restarted — the primary for a machine whose server needs a restart, unless an update is on
 *   offer, which restarts it anyway; its config synced, only while it is connected on this
 *   server's build; its ssh host configured; the program installed again, whatever version it
 *   carries; the program uninstalled. This server's own entry has none.
 * - A verb waits for one reason, and one sentence says it: a job on its way holds all but the ssh
 *   form; a machine being brought back holds stopping, restarting and uninstalling — until the
 *   streak stopped, when nothing waits on it; a stopped server holds restarting; no build to
 *   install holds enabling and reinstalling. No verb waiting, no sentence.
 * - A job's steps are its own: a queued job has every step still to come; a running one is on its
 *   phase with the earlier steps done; one that finished well is a single line; a failed one is
 *   marked failed at its phase, named in words, with the far side's own words — and a step the
 *   server names outside its steps is told as it was named. One that ssh refused before it named a
 *   phase is marked failed at the step its failure names, and says why in the page's language with
 *   ssh's own words under it. What the server's connection check found after a failure comes with
 *   it, check by check, or that it is still checking.
 * - A machine being brought back says where the streak stands as the card's retry status does —
 *   an attempt running, a wait with Retry now, a stop with Retry, a refused password with none —
 *   for how long, the last failure in the page's language when ssh refused, and what the
 *   automatic check found once it ran.
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
import type {
  MachineCheck,
  MachineInfo,
  MachineJob,
  MachineReconnect,
} from "@prismshadow/penguin-server/api";
import {
  checkLine,
  installedText,
  jobSteps,
  jobView,
  machineChip,
  machineFacts,
  machineToolbar,
  programDirOf,
  reconnectView,
} from "../src/features/machines/machine-detail-view";
import type { Fact } from "../src/features/machines/machine-detail-view";
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
const reconnecting: Extract<MachineReading, { kind: "reconnecting" }> = {
  kind: "reconnecting",
  since: "2026-10-10T07:50:00.000Z",
  attempts: 2,
  maxAttempts: 8,
  nextAt: "2026-10-10T07:51:00.000Z",
  message: "nas refused the connection.",
};
const reconnectFailed: Extract<MachineReading, { kind: "reconnectFailed" }> = {
  kind: "reconnectFailed",
  why: "attempts",
  since: "2026-10-10T07:50:00.000Z",
  attempts: 5,
  maxAttempts: 5,
  message: "nas refused the connection.",
};
const reconnectStopped: Extract<MachineReading, { kind: "reconnectStopped" }> = {
  kind: "reconnectStopped",
  since: "2026-10-10T07:50:00.000Z",
  attempts: 2,
  maxAttempts: 5,
  message: "nas refused the connection.",
};
const ready: MachineReading = { kind: "ready", port: 7364 };

/** Every reading a remote machine can have. */
const READINGS: MachineReading[] = [
  { kind: "queued" },
  working,
  reconnecting,
  reconnectFailed,
  reconnectStopped,
  failed,
  ready,
  { kind: "installedOnly" },
  { kind: "behind", version: "0.2.12" },
  { kind: "restartNeeded" },
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
      expect(chip.reason !== null).toBe(
        [
          "failed",
          "unreachable",
          "working",
          "reconnecting",
          "reconnectFailed",
          "reconnectStopped",
          "behind",
          "restartNeeded",
        ].includes(kind),
      );
    },
  );

  it("gives the far side's own words as the reason, and for another build the version on offer", () => {
    expect(machineChip(failed, IMAGE).reason).toContain(failed.message);
    // The step a failure stopped at goes by the name the steps list gives it; a step the server
    // names outside its steps, as the server named it.
    expect(machineChip(failed, IMAGE).reason).toContain(S.machines.step.restart);
    expect(machineChip({ ...failed, step: "ssh" }, IMAGE).reason).toContain("ssh");
    expect(machineChip(unreachable, IMAGE).reason).toBe(unreachable.detail);
    expect(machineChip(working, IMAGE).reason).toBe(working.step);
    expect(machineChip({ kind: "behind", version: "0.2.12" }, IMAGE).reason).toContain(IMAGE);
    // With no build of its own, this server has no version to offer.
    expect(machineChip({ kind: "behind", version: "0.2.12" }, null).reason).toBeNull();
    // A reconnect that has not failed yet has nothing to add to its word.
    expect(machineChip({ ...reconnecting, attempts: 0 }, IMAGE).reason).toBeNull();
  });

  it("says this server's own entry is running, with nothing behind the word", () => {
    const chip = machineChip(null, IMAGE);
    expect(chip).toMatchObject({ word: S.machines.state.serving, tone: "link", reason: null });
  });
});

const machine = (over: Partial<MachineInfo> = {}): MachineInfo => ({
  id: "ssh:nas",
  alias: "nas",
  installed: { version: IMAGE, at: "2026-10-01T08:00:00.000Z" },
  machineId: "NASmachineID0000",
  local: false,
  connection: { pid: 4242 },
  socket: null,
  keepConnected: true,
  api: null,
  status: { state: "running", checkedAt: "2026-10-10T07:59:00.000Z", port: 7364 },
  root: "$HOME/.penguin-dev/data",
  ...over,
});
const job = (over: Partial<MachineJob>): MachineJob => ({
  kind: "use",
  machineId: "ssh:nas",
  alias: "nas",
  queued: false,
  running: false,
  steps: ["check", "install", "handover", "restart", "connect", "sync"],
  phase: null,
  log: [],
  result: null,
  ...over,
});
const lost: MachineReconnect = {
  since: "2026-10-10T07:50:00.000Z",
  attempts: 3,
  maxAttempts: 8,
  nextAt: "2026-10-10T08:01:20.000Z",
  lastError: "the connection to this machine ended",
  diagnosis: null,
};

describe("the toolbar", () => {
  const verbs = (m: MachineInfo, j: MachineJob | null = null, image: string | null = IMAGE) =>
    machineToolbar(m, j, image, false).items.map((item) => item.verb);
  const heldOf = (m: MachineInfo, j: MachineJob | null = null) =>
    machineToolbar(m, j, IMAGE, false)
      .items.filter((item) => item.held !== null)
      .map((i) => i.verb);

  it("offers a connected machine its verbs in one row, none of them twice and none of them waiting", () => {
    expect(verbs(machine())).toEqual([
      "stop",
      "restart",
      "syncConfig",
      "configure",
      "reinstall",
      "uninstall",
    ]);
    expect(machineToolbar(machine(), null, IMAGE, false).sentence).toBeNull();
  });

  it("offers Update first, as the primary, only while the machine carries another build", () => {
    const behind = machine({ installed: { version: "0.2.12", at: "2026-09-20T08:00:00.000Z" } });
    const bar = machineToolbar(behind, null, IMAGE, false);
    expect(bar.items.map((item) => item.verb)).toEqual([
      "update",
      "stop",
      "restart",
      "configure",
      "reinstall",
      "uninstall",
    ]);
    expect(bar.items[0]).toMatchObject({ primary: true, held: null });
    // In sync — or with no build of this server's to compare against — there is nothing to update.
    // Out of sync there is no config sync either: the update hands the config over.
    expect(verbs(machine())).not.toContain("update");
    expect(verbs(behind)).not.toContain("syncConfig");
    expect(verbs(behind, null, null)).not.toContain("update");
  });

  it("offers Restart as the primary while the machine's server needs one, and leaves that to Update when one is on offer", () => {
    const unanswered = { state: "unanswered" as const, since: "2026-10-10T07:59:00.000Z" };
    const bar = machineToolbar(machine({ socket: unanswered }), null, IMAGE, false);
    expect(bar.items.map((item) => item.verb)).toEqual(verbs(machine()));
    expect(bar.items.filter((item) => item.primary).map((item) => item.verb)).toEqual(["restart"]);
    expect(bar.items.find((item) => item.verb === "restart")?.held).toBeNull();

    const behind = machine({
      socket: unanswered,
      installed: { version: "0.2.12", at: "2026-09-20T08:00:00.000Z" },
    });
    const primaries = machineToolbar(behind, null, IMAGE, false).items.filter((i) => i.primary);
    expect(primaries.map((item) => item.verb)).toEqual(["update"]);
  });

  it("starts a server that was stopped, and holds its restart, saying so once", () => {
    const stopped = machine({
      connection: null,
      keepConnected: undefined,
      status: { state: "stopped", checkedAt: "2026-10-10T07:59:00.000Z" },
    });
    expect(verbs(stopped)).toEqual(["start", "restart", "configure", "reinstall", "uninstall"]);
    expect(heldOf(stopped)).toEqual(["restart"]);
    expect(machineToolbar(stopped, null, IMAGE, false).sentence).toBe(
      S.machines.detail.held.stopped,
    );
  });

  it("holds what needs the machine while it is being brought back, and says why in one sentence; once that stopped, nothing waits", () => {
    const away = machine({ reconnect: lost });
    expect(heldOf(away)).toEqual(["stop", "restart", "uninstall"]);
    expect(machineToolbar(away, null, IMAGE, false).sentence).toBe(
      S.machines.detail.held.unreachable,
    );
    for (const gaveUp of ["cancelled", "attempts", "ssh"] as const) {
      const stopped = machine({ reconnect: { ...lost, nextAt: null, gaveUp } });
      expect(heldOf(stopped), gaveUp).toEqual([]);
      expect(machineToolbar(stopped, null, IMAGE, false).sentence, gaveUp).toBeNull();
    }
  });

  it("holds every verb but the ssh form while a job is on its way", () => {
    const running = job({ running: true, phase: "install" });
    expect(heldOf(machine(), running)).toEqual([
      "stop",
      "restart",
      "syncConfig",
      "reinstall",
      "uninstall",
    ]);
    const behind = machine({ installed: { version: "0.2.12", at: "2026-09-20T08:00:00.000Z" } });
    expect(heldOf(behind, running)).toEqual([
      "update",
      "stop",
      "restart",
      "reinstall",
      "uninstall",
    ]);
    expect(machineToolbar(behind, running, IMAGE, false).sentence).toBe(
      S.machines.detail.held.moving,
    );
  });

  it("enables a machine with nothing installed, beside its ssh form and nothing else", () => {
    const added = machine({
      installed: null,
      connection: null,
      keepConnected: undefined,
      status: null,
    });
    const bar = machineToolbar(added, null, IMAGE, false);
    expect(bar.items.map((item) => item.verb)).toEqual(["enable", "configure"]);
    expect(bar.items[0]!.primary).toBe(true);
    // With nothing to install, Enable waits, and says why.
    const none = machineToolbar(added, null, null, true);
    expect(none.items[0]!.held).toBe("noImage");
    expect(none.sentence).toBe(S.machines.detail.held.noImage);
  });

  it("is empty for this server's own entry", () => {
    expect(machineToolbar(machine({ id: "local", local: true }), null, IMAGE, false)).toEqual({
      items: [],
      sentence: null,
    });
  });
});

describe("a job's steps", () => {
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

  it("are the job's own: a checkout's build comes first, and a stop has two", () => {
    const building = job({
      running: true,
      steps: ["build", "check", "install", "handover", "restart", "connect", "sync"],
      phase: "build",
    });
    expect(jobSteps(building).map((step) => [step.name, step.state])).toEqual([
      [S.machines.step.build, "current"],
      ...["check", "install", "handover", "restart", "connect", "sync"].map((phase) => [
        S.machines.step[phase as "check"],
        "pending",
      ]),
    ]);
    const stopping = job({ kind: "stop", running: true, steps: ["check", "stop"], phase: "stop" });
    expect(jobSteps(stopping).map((step) => step.phase)).toEqual(["check", "stop"]);
    expect(states(stopping)).toEqual(["done", "current"]);
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
      check: null,
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

  it("carry what the server's connection check found after the failure, or that it is still checking", () => {
    const result = { ok: false as const, step: "check", message: "the machine said nothing." };
    expect(jobView(job({ result, diagnosis: { state: "running" } }))).toMatchObject({
      check: { kind: "running" },
    });
    const done = jobView(
      job({
        result,
        diagnosis: {
          state: "done",
          machineId: "ssh:nas",
          checkedAt: "2026-10-10T08:00:00.000Z",
          checks: [{ id: "ssh", state: "pass", user: "penguin", host: "nas" }],
        },
      }),
    );
    expect(done).toMatchObject({
      check: { kind: "done", lines: [{ id: "ssh", state: "pass" }] },
    });
  });

  it("tell a failed step the server names outside its steps as it was named", () => {
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

describe("a machine being brought back", () => {
  const NOW = Date.parse("2026-10-10T08:00:00.000Z");

  it("says where the streak stands as the card does, and for how long", () => {
    expect(reconnectView(machine({ reconnect: lost }), "en", NOW)).toMatchObject({
      status: {
        phase: "waiting",
        label: S.machines.retry.trying(4, 8),
        nextAtMs: Date.parse(lost.nextAt!),
        offers: { retryNow: true, stop: true, retry: false },
      },
      lasting: "10 minutes",
      lastError: lost.lastError,
      detail: null,
      check: null,
    });
    const view = (over: Partial<MachineReconnect>) =>
      reconnectView(machine({ reconnect: { ...lost, nextAt: null, ...over } }), "en", NOW)?.status;
    // An attempt under way: only Stop retrying.
    expect(view({})).toMatchObject({
      phase: "trying",
      offers: { retryNow: false, stop: true, retry: false },
    });
    // Stopped, by its limit or by a person: the Retry starts again; a refused password offers
    // nothing, the fix is its SSH settings.
    expect(view({ gaveUp: "attempts" })).toMatchObject({
      phase: "gaveUp",
      offers: { retry: true },
    });
    expect(view({ gaveUp: "cancelled" })).toMatchObject({
      phase: "cancelled",
      offers: { retry: true },
    });
    expect(view({ waitsForPassword: true, sshReason: "password-rejected" })).toMatchObject({
      phase: "blocked",
      offers: { retryNow: false, stop: false, retry: false },
    });
  });

  it("says an ssh refusal in the page's language with ssh's own words under it, and what the automatic check found", () => {
    const refused = reconnectView(
      machine({
        reconnect: {
          ...lost,
          lastError: "nas refused. (ssh: connect to host nas port 22: Connection refused)",
          sshReason: "refused",
          diagnosis: {
            machineId: "ssh:nas",
            checkedAt: "2026-10-10T07:59:00.000Z",
            checks: [
              {
                id: "ssh",
                state: "fail",
                reason: "refused",
                said: "ssh: connect to host nas port 22: Connection refused",
              },
            ],
          },
        },
      }),
      "en",
      NOW,
    );
    expect(refused?.lastError).toBe(S.machines.check.ssh.refused("nas"));
    expect(refused?.detail).toBe(
      S.machines.check.sshSaid("connect to host nas port 22: Connection refused"),
    );
    expect(refused?.check?.map((line) => [line.id, line.state])).toEqual([["ssh", "fail"]]);
  });

  it("is nothing for a machine that is not being brought back", () => {
    expect(reconnectView(machine(), "en", NOW)).toBeNull();
  });

  it("names the program directory the data root sits in", () => {
    expect(programDirOf("$HOME/.penguin-dev/data")).toBe("$HOME/.penguin-dev");
    expect(programDirOf("%USERPROFILE%\\.penguin\\data")).toBe("%USERPROFILE%\\.penguin");
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
    socket: null,
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
