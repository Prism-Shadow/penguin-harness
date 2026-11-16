/**
 * The problem report for a failed model request — what the conversation's 「[详情]」 opens: the
 * UI package's report (`ErrorReport`), filled with what the transcript knows of the request.
 *
 * Its facts are what a maintainer needs to tell a provider's outage from a defect here: what
 * happened (the attempts so far, of how many), the error code and the request's status, the HTTP
 * status and the request id where the provider's message names them (`provider-error.ts`), the
 * provider and the model, and when it happened. The report ends with the provider's message, kept
 * as it came but redacted like every report, the request id spared. The Session's Workspace is
 * kept out of it, and a Session on another machine names that machine's OS. The host's
 * environment (version, how it is installed, OS) and the link to the bug form are the kit's.
 *
 * A provider's failure is not usually PenguinHarness's defect, so its dialog keeps a title and a
 * lead of its own (the chat's dictionary) in place of the kit's.
 */
import type { ErrorReport, ReportFact } from "@prismshadow/penguin-ui";
import { httpStatusOf, requestIdOf } from "./provider-error";

/** Where the failed request stands: the retry line's phases, and a failure that ended the run. */
export type RequestFailurePhase = "waiting" | "trying" | "retried" | "gaveUp" | "fatal";

export interface RequestFailure {
  phase: RequestFailurePhase;
  /** Requests made so far, the first included (request_end.attempt; 1 when unrecorded). */
  attempt: number;
  /** The most a turn makes (the engine's ceiling). */
  maxAttempts: number;
  /** request_end.status: `retryable`, `fatal`, or an old Trace's finer spelling. */
  status: string;
  /** request_end.error_code. */
  errorCode?: string;
  /** request_end.error_message: the provider's own words. */
  message?: string;
  /** The model the request went to. */
  model?: { provider: string; modelId: string };
  /** When the request ended (epoch ms). */
  atMs?: number;
}

/** Where the request ran, beyond what the app's own environment says. */
export interface RequestFailurePlace {
  /** The Session's Workspace path, kept out of the report. */
  workspace?: string | null;
  /** The Session runs on another machine: its OS and version, when known. */
  remote?: { os: string | null; version: string | null } | null;
  /** The dialog's own title and lead (a provider's failure is rarely the app's defect). */
  dialog?: ErrorReport["dialog"];
}

/** What happened, in one line. */
function happened(f: RequestFailure): string {
  const n = f.attempt;
  const of = `attempt ${n} of at most ${f.maxAttempts} failed`;
  switch (f.phase) {
    case "waiting":
      return `${of}, waiting to send attempt ${n + 1}`;
    case "trying":
      return `${of}, sending attempt ${n + 1}`;
    case "retried":
      return `${of}, attempt ${n + 1} was sent`;
    case "gaveUp":
      return `${n} ${n === 1 ? "attempt" : "attempts"} failed (at most ${f.maxAttempts}), and the run ended`;
    case "fatal":
      return `an error no retry can fix ended the run${n > 1 ? ` at attempt ${n}` : ""}`;
  }
}

export function requestFailureReport(
  f: RequestFailure,
  place: RequestFailurePlace = {},
): ErrorReport {
  const http = httpStatusOf(f.message);
  const id = requestIdOf(f.message);
  const facts: [string, string | null][] = [
    ["What happened", happened(f)],
    ["Error code", `${f.errorCode ?? "none"} (status ${f.status})`],
    ["HTTP status", http === null ? null : String(http)],
    ["Provider", f.model?.provider ?? null],
    ["Model", f.model?.modelId ?? null],
    ["Request ID", id],
    [
      "Time (UTC)",
      f.atMs === undefined ? null : new Date(f.atMs).toISOString().replace(/\.\d+Z$/, "Z"),
    ],
  ];
  const model = f.model ? ` (${f.model.provider} / ${f.model.modelId})` : "";
  return {
    heading: "PenguinHarness model request failure",
    title: `Model request failed: ${f.errorCode ?? f.status}${http === null ? "" : `, HTTP ${http}`}${model}`,
    intro: "A model request failed in a conversation.",
    facts: facts.filter((fact): fact is [string, string] => fact[1] !== null) as ReportFact[],
    output: {
      label: "Provider message",
      text: f.message ?? null,
      missing: "(the provider sent no message)",
    },
    ...(id !== null ? { keep: [id] } : {}),
    ...(place.workspace ? { privatePaths: [place.workspace] } : {}),
    ...(place.remote
      ? { environment: { os: place.remote.os, remote: { version: place.remote.version } } }
      : {}),
    ...(place.dialog !== undefined ? { dialog: place.dialog } : {}),
  };
}
