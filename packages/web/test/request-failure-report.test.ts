/**
 * The report a failed model request hands the person (features/chat/request-failure-report.ts),
 * as the UI package's report kit builds it in the app's environment, and the bug form it opens.
 *
 * - Given a failure and where it ran, the report says what happened (the attempts so far, of how
 *   many), the error code and the request's status, the HTTP status and the request id the
 *   provider's message names, the provider and the model, when it happened in UTC, the version,
 *   how it is installed and the OS — then the provider's message itself.
 * - Given a provider's message holding a key, a bearer token or the Workspace's path, the report
 *   and the link hold none of them, and keep the request id.
 * - Given a fact nobody knows yet (the version not read), the report leaves its line out and the
 *   form's System info says "unknown", so the form's required fields are never empty.
 * - Given a Session on another machine, the OS line says it is that machine's.
 * - The link opens the project's bug form with the fields it requires filled — the failure in
 *   What happened, the version, install and OS in System info — and the provider's message in
 *   Error output; nothing else is asked of the person before submitting.
 * - Given a provider's message too long for a link, the link stays under the cap and says the
 *   message was cut; the copied report keeps it whole.
 */
import { describe, expect, it } from "vitest";
import { ISSUE_FORM_URL, ISSUE_URL_CAP, buildReport } from "@prismshadow/penguin-ui";
import type { ReportEnvironment } from "@prismshadow/penguin-ui";
import { requestFailureReport } from "../src/features/chat/request-failure-report";
import type {
  RequestFailure,
  RequestFailurePlace,
} from "../src/features/chat/request-failure-report";

const ID = "req_011CUz3tF8eJ2dQx6Q9pY7Ln";
const WORKSPACE = "/home/alice/projects/acme-secret";
const MESSAGE = `503 {"type":"error","error":{"type":"overloaded_error","message":"overloaded"},"request_id":"${ID}"}`;

const failure = (over: Partial<RequestFailure> = {}): RequestFailure => ({
  phase: "gaveUp",
  attempt: 6,
  maxAttempts: 10,
  status: "retryable",
  errorCode: "network",
  message: MESSAGE,
  model: { provider: "custom", modelId: "claude-4-8" },
  atMs: Date.parse("2026-11-02T08:41:13.512Z"),
  ...over,
});

const ENV: ReportEnvironment = { version: "v0.2.18", install: "desktop", os: "macOS (arm64)" };

/** The failure's report as the app builds it: in the app's environment, its Workspace kept out. */
const reportOf = (
  f: RequestFailure,
  env: ReportEnvironment = ENV,
  place: RequestFailurePlace = { workspace: WORKSPACE },
) => buildReport(requestFailureReport(f, place), env);

/** The bug form's prefilled fields, read back off the link. */
const fieldsOf = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("a failed request's report", () => {
  it("says what happened, where and on what, then the provider's own message", () => {
    const { markdown } = reportOf(failure());
    expect(markdown).toContain(
      "- What happened: 6 attempts failed (at most 10), and the run ended",
    );
    expect(markdown).toContain("- Error code: network (status retryable)");
    expect(markdown).toContain("- HTTP status: 503");
    expect(markdown).toContain("- Provider: custom");
    expect(markdown).toContain("- Model: claude-4-8");
    expect(markdown).toContain(`- Request ID: ${ID}`);
    expect(markdown).toContain("- Time (UTC): 2026-11-02T08:41:13Z");
    expect(markdown).toContain("- PenguinHarness: v0.2.18");
    expect(markdown).toContain("- Installed as: Desktop app");
    expect(markdown).toContain("- OS: macOS (arm64)");
    expect(markdown).toContain(`\`\`\`text\n${MESSAGE}\n\`\`\``);
    const waiting = reportOf(failure({ phase: "waiting", attempt: 2 })).markdown;
    expect(waiting).toContain(
      "- What happened: attempt 2 of at most 10 failed, waiting to send attempt 3",
    );
  });

  it("holds no key, token or Workspace path from the provider's message, and keeps its request id", () => {
    const leaky = `401 Incorrect API key provided: sk-proj-Ab3dEf6hIj9kLm2nOp5q (Authorization: Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a0) reading ${WORKSPACE}/notes.md; request_id: ${ID}`;
    const report = reportOf(failure({ message: leaky }));
    for (const shared of [report.markdown, decodeURIComponent(report.issueUrl)]) {
      expect(shared).not.toContain("sk-proj-Ab3dEf6hIj9kLm2nOp5q");
      expect(shared).not.toContain("9f8e7d6c5b4a39281706f5e4d3c2b1a0");
      expect(shared).not.toContain(WORKSPACE);
      expect(shared).toContain(ID);
    }
  });

  it("leaves out what nobody knows yet, and names a remote machine's OS as that machine's", () => {
    const unknown = reportOf(failure(), { ...ENV, version: null, os: null });
    expect(unknown.markdown).not.toContain("PenguinHarness:");
    expect(unknown.markdown).not.toContain("- OS:");
    expect(fieldsOf(unknown.issueUrl)["system-info"]).toBe(
      "Version: unknown\nInstalled as: Desktop app\nOS: unknown",
    );
    const remote = reportOf(failure(), ENV, {
      workspace: WORKSPACE,
      remote: { os: "Linux (x64)", version: "v0.2.16" },
    });
    expect(remote.markdown).toContain(
      "- OS: Linux (x64), the remote machine the Session runs on (PenguinHarness v0.2.16)",
    );
  });

  it("opens the project's bug form with the fields it requires filled, and the provider's message as its output", () => {
    const { issueUrl } = reportOf(failure());
    expect(issueUrl.startsWith(`${ISSUE_FORM_URL}?`)).toBe(true);
    const fields = fieldsOf(issueUrl);
    expect(Object.keys(fields).sort()).toEqual([
      "output",
      "summary",
      "system-info",
      "template",
      "title",
    ]);
    expect(fields).toMatchObject({
      template: "bug_report.yml",
      title: "Model request failed: network, HTTP 503 (custom / claude-4-8)",
      "system-info": "Version: v0.2.18\nInstalled as: Desktop app\nOS: macOS (arm64)",
      output: MESSAGE,
    });
    expect(fields.summary).toContain("- What happened: 6 attempts failed (at most 10)");
    expect(fields.summary).toContain("- Model: claude-4-8");
    expect(fields.summary).not.toContain("Installed as");
  });

  it("keeps a long message's link under the cap and says it was cut, while the report keeps it whole", () => {
    const long = `503 ${"upstream overloaded; ".repeat(600)}`;
    const report = reportOf(failure({ message: long }));
    expect(report.issueUrl.length).toBeLessThanOrEqual(ISSUE_URL_CAP);
    const output = fieldsOf(report.issueUrl).output!;
    expect(output.startsWith("503 upstream overloaded")).toBe(true);
    expect(output).toContain("cut short");
    expect(report.markdown).toContain(long);
  });
});
