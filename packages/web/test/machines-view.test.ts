/**
 * machines-view unit tests: the one reading a Machines card gives, whether Use can start a
 * conversation there and why not, and the machines in use.
 *
 * The reading's precedence is the point. The server's job for a machine is the freshest
 * word; then the server bringing back a machine it keeps connected, whatever its connection
 * says; a held connection settles "ready" over an older failed job, since a re-hold that
 * brought the machine back must not leave the row saying it failed; and "in use" comes from
 * the machine's own persisted record, never from the job slot.
 *
 * Use starts a conversation on this server always, and on another machine while it is
 * connected and nothing moves there; otherwise the card says why in a word — stopped, not
 * installed, failed — and says nothing while a job's stepper, or the retry status of a machine
 * being brought back, already does.
 *
 * The retry status of a machine being brought back:
 * - Given an attempt running, it is trying the one past the failures so far, of how many.
 * - Given a wait, it says which attempt failed (or, before any, that the connection was lost),
 *   counts down to the next and offers Retry now.
 * - Given a stop after the failures in a row, or at an ssh refusal no retry mends, it says where
 *   it stopped and why, and offers Retry; a refused password says the fix and offers none.
 * - Given a machine not being brought back, there is none.
 *
 * The image notice:
 * - Given a server with no image and no checkout, the page says so and stops adding machines.
 * - Given a source checkout that has not built its image yet, nothing stops the page.
 * - Given a checkout whose last build failed, the page shows the build's own words, and still
 *   lets a person try again.
 * `socketReading` is the detail list's other fact, and tested here for the same reason: it is
 * a derivation, not a render — which state reads as which word and which tone, and that there
 * is no reading at all where the server reported no socket.
 */
import { describe, expect, it } from "vitest";
import type {
  MachineInfo,
  MachineJob,
  MachineSocketFact,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";
import {
  anyJobPending,
  behindMachines,
  imageNotice,
  machinesInUse,
  jobFor,
  localMachine,
  outOfDate,
  readMachine,
  readingTone,
  retryReading,
  canUse,
  useWaitsBecause,
  socketReading,
} from "../src/features/machines/machines-view";
import type { MachineReading } from "../src/features/machines/machines-view";
import { S } from "../src/lib/strings";

const INSTALLED = { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" };

const fresh = (alias: string): MachineInfo => ({
  id: `ssh:${alias}`,
  alias,
  machineId: null,
  installed: null,
  local: false,
  connection: null,
  socket: null,
  api: null,
  root: "$HOME/.penguin/data",
  status: null,
});
const carrying = (alias: string): MachineInfo => ({ ...fresh(alias), installed: INSTALLED });
/** The entry the server puts first: this very machine. */
const here = (): MachineInfo => ({
  id: "local",
  alias: "workstation",
  machineId: "LNrJdHAZJ91G58i0",
  installed: INSTALLED,
  local: true,
  connection: null,
  socket: null,
  api: null,
  root: "/home/someone/.penguin/data",
  status: { state: "running", checkedAt: INSTALLED.at, port: 7364 },
});

function response(
  jobs: MachineJob[],
  opts: { imageVersion?: string | null; machines?: MachineInfo[] } = {},
): MachinesResponse {
  return {
    machines: opts.machines ?? [fresh("build-box"), fresh("nas")],
    imageVersion: opts.imageVersion === undefined ? "9.9.9" : opts.imageVersion,
    job: jobs.find((job) => job.running) ?? jobs.at(-1) ?? null,
    jobs,
  };
}

function job(over: Partial<MachineJob> = {}): MachineJob {
  return {
    kind: "use",
    machineId: "ssh:nas",
    alias: "nas",
    queued: false,
    running: true,
    steps: ["check", "install", "handover", "restart", "connect", "sync"],
    phase: null,
    log: ["Installing 9.9.9 on deploy@nas…"],
    result: null,
    ...over,
  };
}

const failed = job({
  running: false,
  result: { ok: false, step: "connect", message: "Permission denied.", canReplaceProgram: true },
});

describe("readMachine", () => {
  it("a queued job reads as waiting, before anything the machine's own record says", () => {
    const nas = { ...carrying("nas"), connection: { pid: 1 } };
    expect(readMachine(nas, job({ queued: true, running: false }), "9.9.9")).toEqual({
      kind: "queued",
    });
  });

  it("a running job reads as working, with its latest line", () => {
    expect(readMachine(carrying("nas"), job(), "9.9.9")).toEqual({
      kind: "working",
      step: "Installing 9.9.9 on deploy@nas…",
    });
    expect(readMachine(carrying("nas"), job({ log: [] }), "9.9.9")).toEqual({
      kind: "working",
      step: null,
    });
  });

  it("a held connection is ready, even over an older failed job", () => {
    const nas: MachineInfo = {
      ...carrying("nas"),
      connection: { pid: 1 },
      status: { state: "running", checkedAt: INSTALLED.at, port: 7364 },
    };
    expect(readMachine(nas, failed, "9.9.9")).toEqual({ kind: "ready", port: 7364 });
  });

  it("a machine the server is bringing back reads as reconnecting, whatever its connection says", () => {
    // The ssh session may still be up while the server behind it stopped: that is exactly the
    // state the server notices and brings back, and the card must not call it connected.
    const nas: MachineInfo = {
      ...carrying("nas"),
      connection: { pid: 1 },
      keepConnected: true,
      reconnect: {
        since: "2026-08-24T12:00:00.000Z",
        attempts: 2,
        maxAttempts: 8,
        nextAt: null,
        lastError: "the connection to this machine ended",
        diagnosis: null,
      },
    };
    const reading = readMachine(nas, failed, "9.9.9");
    expect(reading).toEqual({
      kind: "reconnecting",
      since: "2026-08-24T12:00:00.000Z",
      attempts: 2,
      maxAttempts: 8,
      nextAt: null,
    });
    expect(readingTone(reading)).toBe("busy");
    // A job on its way still speaks first.
    expect(readMachine(nas, job(), "9.9.9").kind).toBe("working");
  });

  it("a machine the server stopped bringing back says why it stopped, in the page's language, and waits on a person", () => {
    const stopped = (gaveUp: "attempts" | "ssh"): MachineInfo => ({
      ...carrying("nas"),
      keepConnected: true,
      reconnect: {
        since: "2026-08-24T12:00:00.000Z",
        attempts: gaveUp === "attempts" ? 8 : 1,
        maxAttempts: 8,
        nextAt: null,
        gaveUp,
        lastError: "nas refused. (ssh: connect to host nas port 22: Connection refused)",
        sshReason: gaveUp === "attempts" ? "refused" : "auth",
        diagnosis: null,
      },
    });
    const tired = readMachine(stopped("attempts"), null, "9.9.9");
    expect(tired).toMatchObject({
      kind: "reconnectStopped",
      why: "attempts",
      attempts: 8,
      message: S.machines.check.ssh.refused("nas"),
    });
    expect(readingTone(tired)).toBe("attention");
    expect(readMachine(stopped("ssh"), null, "9.9.9")).toMatchObject({
      kind: "reconnectStopped",
      why: "ssh",
      message: S.machines.check.ssh.auth("nas"),
    });
    // A refused password is its own stop, whatever else the streak says.
    const locked: MachineInfo = {
      ...stopped("ssh"),
      reconnect: {
        ...stopped("ssh").reconnect!,
        waitsForPassword: true,
        sshReason: "password-rejected",
      },
    };
    expect(readMachine(locked, null, "9.9.9").kind).toBe("signInRefused");
  });

  it("a failed job keeps the failing step, the far side's words and the forced-install offer", () => {
    expect(readMachine(carrying("nas"), failed, "9.9.9")).toEqual({
      kind: "failed",
      step: "connect",
      message: "Permission denied.",
      canReplaceProgram: true,
    });
  });

  it("a job ssh refused reads in the page's language, from the reason the server found", () => {
    const refused = job({
      running: false,
      result: {
        ok: false,
        step: "check",
        message:
          "This computer cannot find nas's host name. Check its HostName in the ssh config. (ssh: Could not resolve hostname nas.lan)",
        canReplaceProgram: false,
        sshReason: "host-not-found",
      },
    });
    expect(readMachine(carrying("nas"), refused, "9.9.9")).toEqual({
      kind: "failed",
      step: "check",
      message: S.machines.check.ssh["host-not-found"]("nas"),
      canReplaceProgram: false,
    });
  });

  it("a machine on another build is behind while its server runs, and stopped once it is stopped", () => {
    const nas: MachineInfo = {
      ...carrying("nas"),
      status: { state: "running", checkedAt: INSTALLED.at, port: 7364 },
    };
    expect(readMachine(nas, null, "9.9.10")).toEqual({ kind: "behind", version: "9.9.9" });
    // Just stopped by a person, it reads as stopped: the build is the pill's to say.
    const stopped: MachineInfo = { ...nas, status: { state: "stopped", checkedAt: INSTALLED.at } };
    expect(readMachine(stopped, null, "9.9.10")).toEqual({ kind: "stopped" });
  });

  it("the last probe speaks when no job and no connection do", () => {
    const at = INSTALLED.at;
    expect(readMachine(carrying("nas"), null, "9.9.9")).toEqual({ kind: "unknown" });
    expect(
      readMachine(
        {
          ...carrying("nas"),
          status: { state: "unreachable", checkedAt: at, detail: "timed out" },
        },
        null,
        "9.9.9",
      ),
    ).toEqual({ kind: "unreachable", detail: "timed out" });
    expect(
      readMachine(
        { ...carrying("nas"), status: { state: "stopped", checkedAt: at } },
        null,
        "9.9.9",
      ),
    ).toEqual({ kind: "stopped" });
    expect(
      readMachine(
        { ...carrying("nas"), status: { state: "running", checkedAt: at, port: 7364 } },
        null,
        "9.9.9",
      ),
    ).toEqual({ kind: "notConnected" });
  });

  it("a use that ended at installed, with nothing held, is as far as it goes", () => {
    const installedOnly = job({
      running: false,
      result: { ok: true, installed: "installed", version: "9.9.9" },
    });
    expect(readMachine(carrying("nas"), installedOnly, "9.9.9")).toEqual({ kind: "installedOnly" });
  });

  it("tones follow meaning: moving is busy, connected is a link, a failed job is danger, out of reach and the rest want attention, and what waits on no one recedes", () => {
    expect(readingTone({ kind: "working", step: null })).toBe("busy");
    expect(readingTone({ kind: "ready", port: 7364 })).toBe("link");
    expect(
      readingTone({ kind: "failed", step: "restart", message: "", canReplaceProgram: false }),
    ).toBe("danger");
    expect(readingTone({ kind: "unreachable", detail: null })).toBe("attention");
    expect(readingTone({ kind: "stopped" })).toBe("attention");
    // Installed as far as this server can take it, or never checked: nothing to do about it.
    expect(readingTone({ kind: "installedOnly" })).toBe("muted");
    expect(readingTone({ kind: "unknown" })).toBe("muted");
  });
});

describe("Use", () => {
  const connected: MachineInfo = {
    ...carrying("nas"),
    connection: { pid: 1 },
    keepConnected: true,
  };
  const waits = (machine: MachineInfo, of: MachineJob | null = null) =>
    useWaitsBecause(machine, of, readMachine(machine, of, "9.9.9"));

  it("starts a conversation on this server always, and on a machine while it is connected", () => {
    expect(canUse(here(), null)).toBe(true);
    expect(canUse(connected, null)).toBe(true);
    expect(waits(connected)).toBeNull();
  });

  it("waits while a job moves on the machine, and says nothing: the stepper does", () => {
    expect(canUse(connected, job())).toBe(false);
    expect(waits(connected, job())).toBeNull();
    expect(waits(connected, job({ queued: true, running: false }))).toBeNull();
  });

  it("waits on a machine being brought back, or stopped coming back, and leaves the saying to its retry status", () => {
    const back = (over: Partial<NonNullable<MachineInfo["reconnect"]>> = {}): MachineInfo => ({
      ...connected,
      reconnect: {
        since: "2026-08-24T12:04:00.000Z",
        attempts: 1,
        maxAttempts: 8,
        nextAt: null,
        lastError: null,
        diagnosis: null,
        ...over,
      },
    });
    for (const machine of [
      back(),
      back({ gaveUp: "attempts" }),
      back({ waitsForPassword: true, sshReason: "password-rejected" }),
    ]) {
      expect(canUse(machine, null)).toBe(false);
      expect(waits(machine)).toBeNull();
    }
  });

  it("says why for a stopped server, a machine with nothing installed, and a failed job", () => {
    const why = S.machines.card.why;
    expect(
      waits({ ...carrying("nas"), status: { state: "stopped", checkedAt: INSTALLED.at } }),
    ).toBe(why.stopped);
    expect(waits({ ...fresh("spare"), member: true })).toBe(why.notInstalled);
    expect(waits(carrying("nas"), failed)).toBe(why.failed);
  });
});

describe("the retry status of a machine being brought back", () => {
  const r = S.machines.retry;
  const coming = (attempts: number, nextAt: string | null): MachineReading => ({
    kind: "reconnecting",
    since: "2026-08-24T12:00:00.000Z",
    attempts,
    maxAttempts: 8,
    nextAt,
  });
  const stopped = (why: "attempts" | "ssh"): MachineReading => ({
    kind: "reconnectStopped",
    why,
    since: "2026-08-24T12:00:00.000Z",
    attempts: 8,
    maxAttempts: 8,
    message: "nas refused the connection.",
  });

  it("is trying the attempt past the failures so far, with nothing to press", () => {
    expect(retryReading(coming(3, null), "nas")).toEqual({
      phase: "trying",
      label: r.trying(4, 8),
      reason: null,
      nextAtMs: null,
      canRetry: false,
    });
  });

  it("while it waits, says which attempt failed — or that the connection was lost — counts down, and offers Retry now", () => {
    const next = "2026-08-24T12:01:20.000Z";
    expect(retryReading(coming(3, next), "nas")).toEqual({
      phase: "waiting",
      label: r.failed(3, 8),
      reason: null,
      nextAtMs: Date.parse(next),
      canRetry: true,
    });
    expect(retryReading(coming(0, next), "nas")?.label).toBe(r.lost);
  });

  it("after a stop, says where it stopped and why, and offers Retry", () => {
    expect(retryReading(stopped("attempts"), "nas")).toEqual({
      phase: "gaveUp",
      label: r.gaveUp(8),
      reason: "nas refused the connection.",
      nextAtMs: null,
      canRetry: true,
    });
    expect(retryReading(stopped("ssh"), "nas")).toMatchObject({
      phase: "blocked",
      label: r.stoppedSsh,
      canRetry: true,
    });
  });

  it("for a refused password, says the fix and offers no Retry, which could lock the account", () => {
    expect(retryReading({ kind: "signInRefused", reason: "password-rejected" }, "nas")).toEqual({
      phase: "blocked",
      label: r.stoppedPassword,
      reason: S.machines.check.ssh["password-rejected"]("nas"),
      nextAtMs: null,
      canRetry: false,
    });
  });

  it("is nothing for a machine that is not being brought back", () => {
    expect(retryReading({ kind: "ready", port: 7364 }, "nas")).toBeNull();
    expect(retryReading({ kind: "stopped" }, "nas")).toBeNull();
  });
});

describe("jobs and polling", () => {
  it("finds a machine's job by id", () => {
    expect(jobFor([failed], "ssh:nas")).toBe(failed);
    expect(jobFor([failed], "ssh:build-box")).toBeNull();
  });

  it("keeps polling while anything is queued or running, and stops once all have finished", () => {
    expect(anyJobPending(response([job({ queued: true, running: false })]))).toBe(true);
    expect(anyJobPending(response([job()]))).toBe(true);
    expect(anyJobPending(response([failed]))).toBe(false);
    expect(anyJobPending(response([]))).toBe(false);
  });
});

describe("machinesInUse", () => {
  const older = { version: "9.9.8", at: "2026-08-20T00:00:00.000Z" };

  it("is empty when nothing has been installed or added", () => {
    expect(machinesInUse(response([]))).toEqual([]);
  });

  it("keeps this Project's machines, by name — never by install time, which an update rewrites", () => {
    const nas = { ...carrying("nas"), installed: older };
    const box = carrying("build-box");
    expect(machinesInUse(response([], { machines: [here(), fresh("spare"), nas, box] }))).toEqual([
      box,
      nas,
    ]);
    // The same two after nas was just updated: the order does not move.
    const fresher = { ...nas, installed: { version: "9.9.9", at: "2026-09-01T00:00:00.000Z" } };
    expect(
      machinesInUse(response([], { machines: [here(), fresh("spare"), fresher, box] })),
    ).toEqual([box, fresher]);
  });

  it("keeps a machine added to this Project that nothing is installed on yet, and it reads as not installed", () => {
    const added: MachineInfo = { ...fresh("spare"), member: true };
    expect(machinesInUse(response([], { machines: [here(), added, fresh("other")] }))).toEqual([
      added,
    ]);
    expect(readMachine(added, null, "9.9.9")).toEqual({ kind: "notInstalled" });
    expect(canUse(added, null)).toBe(false);
    // Its first enable says how it goes, and how it failed, rather than "not installed".
    expect(readMachine(added, failed, "9.9.9").kind).toBe("failed");
    expect(readMachine(added, job(), "9.9.9").kind).toBe("working");
  });

  it("compares names naturally, so gpu-2 sits before gpu-10", () => {
    const two = carrying("gpu-2");
    const ten = carrying("gpu-10");
    const one = carrying("GPU-1");
    expect(machinesInUse(response([], { machines: [here(), ten, two, one] }))).toEqual([
      one,
      two,
      ten,
    ]);
  });

  it("does not mutate the response's own machine order (the add dialog reads it too)", () => {
    const nas = { ...carrying("nas"), installed: older };
    const box = carrying("build-box");
    const state = response([], { machines: [nas, box] });
    machinesInUse(state);
    expect(state.machines).toEqual([nas, box]);
  });
});

describe("behindMachines", () => {
  it("is the machines in use on another build, in list order, and nothing without a record", () => {
    const old = { ...carrying("old"), installed: { version: "9.9.8", at: INSTALLED.at } };
    const state = response([], { machines: [here(), fresh("spare"), carrying("nas"), old] });
    expect(behindMachines(state).map((machine) => machine.id)).toEqual(["ssh:old"]);
    expect(behindMachines({ ...state, imageVersion: null })).toEqual([]);
  });
});

describe("the local machine", () => {
  it("is the entry flagged local, wherever the server put it", () => {
    expect(localMachine(response([], { machines: [fresh("nas"), here()] }))?.id).toBe("local");
    expect(localMachine(response([]))).toBeNull();
  });
});

describe("outOfDate", () => {
  it("compares the record's build against what this server would install", () => {
    expect(outOfDate(carrying("nas"), "9.9.9")).toBe(false);
    expect(outOfDate(carrying("nas"), "9.9.10")).toBe(true);
  });

  it("is never true without an image, for a fresh machine, or for this machine", () => {
    expect(outOfDate(carrying("nas"), null)).toBe(false);
    expect(outOfDate(fresh("nas"), "9.9.10")).toBe(false);
    expect(outOfDate(here(), "9.9.10")).toBe(false);
  });
});

describe("the image notice", () => {
  it("a server with no image and nothing to build one from stops the page", () => {
    expect(imageNotice(response([], { imageVersion: null }))).toEqual({ kind: "noImage" });
    expect(imageNotice(response([]))).toBeNull();
  });

  it("a source checkout that has not built its image yet stops nothing", () => {
    const unbuilt: MachinesResponse = {
      ...response([], { imageVersion: null }),
      checkoutImage: { state: "unbuilt" },
    };
    expect(imageNotice(unbuilt)).toBeNull();
    expect(imageNotice({ ...unbuilt, checkoutImage: { state: "building" } })).toBeNull();
  });

  it("a checkout whose last build failed shows the build's own words, not the no-image refusal", () => {
    const state: MachinesResponse = {
      ...response([], { imageVersion: null }),
      checkoutImage: { state: "failed", detail: "[deploy] spawnSync pnpm ENOENT" },
    };
    expect(imageNotice(state)).toEqual({
      kind: "buildFailed",
      detail: "[deploy] spawnSync pnpm ENOENT",
    });
  });
});

describe("socketReading", () => {
  /** A machine this server holds a connected socket to, in the given state. */
  const withSocket = (socket: MachineSocketFact): MachineInfo => ({
    ...carrying("nas"),
    connection: { pid: 1 },
    socket,
  });

  it("reads the state in a word, since when, and the transport's own words", () => {
    expect(
      socketReading(
        withSocket({
          state: "failed",
          since: "2026-08-24T12:03:00.000Z",
          detail: "connect ECONNREFUSED 10.0.0.7:7364",
        }),
      ),
    ).toEqual({
      label: "失败",
      tone: "danger",
      since: "2026-08-24T12:03:00.000Z",
      detail: "connect ECONNREFUSED 10.0.0.7:7364",
    });
  });

  it("has no detail when the transport said nothing", () => {
    expect(socketReading(withSocket({ state: "connected", since: INSTALLED.at }))).toMatchObject({
      detail: null,
    });
  });

  it("is null where there is no socket: this machine, and any machine no stream has asked for", () => {
    // `local` needs no socket, and every other machine reports null until a stream asks —
    // the fact is a process on THIS side, honest about not existing rather than "connected".
    expect(socketReading(here())).toBeNull();
    expect(socketReading(fresh("nas"))).toBeNull();
    expect(socketReading(carrying("nas"))).toBeNull();
  });

  it("tones follow meaning: a live handshake is a link, a dial in flight is work, refusal and failure want a person", () => {
    const tone = (state: MachineSocketFact["state"]): string | undefined =>
      socketReading(withSocket({ state, since: INSTALLED.at }))?.tone;
    expect(tone("connected")).toBe("link");
    expect(tone("dialling")).toBe("busy");
    expect(tone("refused")).toBe("attention");
    expect(tone("failed")).toBe("danger");
  });

  it("names each state, so the four are told apart on the page and not only by tone", () => {
    const label = (state: MachineSocketFact["state"]): string | undefined =>
      socketReading(withSocket({ state, since: INSTALLED.at }))?.label;
    expect([label("connected"), label("dialling"), label("refused"), label("failed")]).toEqual([
      "已连接",
      "拨号中",
      "被拒绝",
      "失败",
    ]);
  });
});
