/**
 * The runtime handshake: what a machine's server answers about the build ITS PROCESS runs, and
 * what this hub makes of that answer.
 *
 * `GET /api/version` answers the pushed state of that machine's data root — the build on its
 * DISK — beside the release its process was compiled into. A hot update moves the disk and not
 * the process: the routes that build added (the API socket above all) are not there, every
 * stream this hub dials fails, and nothing the version door answers says so. So a machine answers
 * one more read-only question, `GET /api/handshake`, with the report taken at the process's first
 * boot, which a hot update cannot move.
 *
 * The answer is typed and holds that one thing — no protocol number, no capability list: what a
 * build serves is a property of the build, and the question is whether both sides hold the SAME
 * one. A server older than this door answers 404 — an unknown identity, not a failure.
 */
import type { VersionReport } from "@prismshadow/penguin-core";
import type { MachineApi } from "./machine-api.js";
import { runningBuild, runsPlan } from "./install-server.js";
import type { PushPlan, RunningBuild } from "./install-server.js";

/** The door a machine's server answers the handshake on. */
export const HANDSHAKE_PATH = "/api/handshake";

/** The answer, typed: the build this process loaded at its start, in the version door's shape. */
export interface HandshakeAnswer {
  identity: VersionReport;
}

/** What one question came back with. */
export type HandshakeReading =
  /** It answered the build its process runs. */
  | { kind: "answered"; identity: VersionReport }
  /** It has no such door (404): its build is unknown, not failed. */
  | { kind: "unknown"; detail: string }
  | { kind: "failed"; detail: string };

/** What the answer to `GET /api/handshake` means. Pure: the wire is text, so it is checked. */
export function readHandshakeAnswer(status: number, text: string): HandshakeReading {
  if (status === 404) {
    return { kind: "unknown", detail: "it has no handshake door (404), so its build is unknown" };
  }
  if (status !== 200) {
    return { kind: "failed", detail: `it answered ${status} when asked its handshake` };
  }
  let body: { identity?: unknown };
  try {
    body = JSON.parse(text) as { identity?: unknown };
  } catch {
    return {
      kind: "failed",
      detail: `it answered 200 with something that is not a handshake: ${text.trim().slice(0, 200)}`,
    };
  }
  const identity = typeof body === "object" && body !== null ? body.identity : undefined;
  if (identity === null || identity === undefined || typeof identity !== "object") {
    return { kind: "failed", detail: `its answer names no build: ${text.trim().slice(0, 200)}` };
  }
  // The version door's own reader: a report that names no version is no build to compare with.
  if (runningBuild(identity) === null) {
    return { kind: "failed", detail: `its answer names no version: ${text.trim().slice(0, 200)}` };
  }
  return { kind: "answered", identity: identity as VersionReport };
}

/** The one question, asked over the machine's connection as its admin. Never throws. */
export async function askHandshake(api: MachineApi): Promise<HandshakeReading> {
  try {
    const answer = await api.request("GET", HANDSHAKE_PATH);
    return readHandshakeAnswer(answer.status, answer.text);
  } catch (err) {
    return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** What a reading says about the plan this hub serves — the existing judgement, not a new one. */
export type HandshakeJudgement =
  | { inLine: true; build: RunningBuild }
  | {
      inLine: false;
      /** What it answers it runs, when that could be read at all. */
      build: RunningBuild | null;
      /** Its build in the spelling a plan uses (`9.9.9`, `9.9.9+hmr.<sha>`). */
      version: string | null;
      detail: string;
    };

/** `runningBuild` reads the report into a build; `runsPlan` says whether that is this hub's. */
export function judgeHandshake(reading: HandshakeReading, plan: PushPlan): HandshakeJudgement {
  if (reading.kind !== "answered") {
    return { inLine: false, build: null, version: null, detail: reading.detail };
  }
  const build = runningBuild(reading.identity);
  if (build === null) {
    return { inLine: false, build: null, version: null, detail: "its answer names no build" };
  }
  if (runsPlan(build, plan)) return { inLine: true, build };
  return {
    inLine: false,
    build,
    version: build.version,
    detail: `it answers ${build.version} where this hub serves ${plan.version}`,
  };
}
