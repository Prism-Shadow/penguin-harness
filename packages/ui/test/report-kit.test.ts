/**
 * The problem report kit (src/components/report/): which errors offer a report, what a report
 * holds, and the bug form it opens.
 *
 * - Which errors are serious: the server's converged 500 and a 5xx it did not name, and anything
 *   thrown that is not the server's answer; never an answer the server named (validation,
 *   permission, not found, a proxy in the way, the network gone), never a stop.
 * - Given a report and the host's environment, the report holds the facts, the version, how it
 *   is installed and the OS, then the raw text; the link opens the bug form with the fields it
 *   requires (`summary`, `system-info`) filled, "unknown" for an environment fact not read yet.
 * - Given private paths, home directories or key-shaped strings in the facts or the raw text,
 *   neither the report nor the link holds them.
 * - Given a raw text too long for a link, the link stays under the cap and says it was cut; the
 *   copied report keeps it whole.
 * - Given an exception, its report names what happened, the page as a pattern and the error, and
 *   ends with the stack and the component stack.
 * - How it is installed, and an OS, are named as people name them.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  ISSUE_FORM_URL,
  ISSUE_URL_CAP,
  UNKNOWN_ENVIRONMENT,
  buildReport,
  installKindOf,
  osName,
} from "../src/components/report/error-report";
import type { ErrorReport, ReportEnvironment } from "../src/components/report/error-report";
import { exceptionReport } from "../src/components/report/exception-report";
import { setReportRoute } from "../src/components/report/report-store";
import { isSeriousError } from "../src/components/report/seriousness";

const answer = (status: number, code: string) =>
  Object.assign(new Error("message"), { name: "ApiError", status, code });

const ENV: ReportEnvironment = { version: "v0.2.18", install: "desktop", os: "macOS (arm64)" };

const report = (over: Partial<ErrorReport> = {}): ErrorReport => ({
  heading: "PenguinHarness error report",
  title: "Unexpected error: internal (HTTP 500)",
  intro: "An unexpected error happened in the PenguinHarness Web App.",
  facts: [
    ["What happened", "an action failed with an unexpected error"],
    ["Page", "/chat/:sessionId"],
  ],
  output: { label: "Error", text: "Internal server error.", missing: "(no further detail)" },
  ...over,
});

/** The bug form's prefilled fields, read back off the link. */
const fieldsOf = (url: string) => Object.fromEntries(new URL(url).searchParams);

afterEach(() => setReportRoute(null));

describe("which errors offer a report", () => {
  it.each<[string, unknown, boolean]>([
    ["the server's converged 500", answer(500, "internal"), true],
    ["a 5xx the server did not name", answer(502, "http_error"), true],
    ["an exception the app did not expect", new TypeError("x is undefined"), true],
    ["a thrown string", "boom", true],
    ["a validation error", answer(400, "validation_failed"), false],
    ["a refused permission", answer(403, "forbidden"), false],
    ["a 5xx the server named (a machine out of reach)", answer(503, "machine_unreachable"), false],
    ["a proxy's page in the server's place", answer(502, "not_the_server"), false],
    ["the network gone", answer(0, "network_error"), false],
    ["a stop the person made", Object.assign(new Error("aborted"), { name: "AbortError" }), false],
    ["nothing at all", null, false],
  ])("%s: %s", (_, err, serious) => {
    expect(isSeriousError(err)).toBe(serious);
  });
});

describe("a problem report", () => {
  it("holds the facts and where it ran, and opens the bug form with its required fields filled", () => {
    const built = buildReport(report(), ENV);
    expect(built.markdown).toBe(
      [
        "### PenguinHarness error report",
        "",
        "- What happened: an action failed with an unexpected error",
        "- Page: /chat/:sessionId",
        "- PenguinHarness: v0.2.18",
        "- Installed as: Desktop app",
        "- OS: macOS (arm64)",
        "",
        "Error:",
        "",
        "```text\nInternal server error.\n```",
      ].join("\n"),
    );
    expect(built.issueUrl.startsWith(`${ISSUE_FORM_URL}?`)).toBe(true);
    expect(fieldsOf(built.issueUrl)).toEqual({
      template: "bug_report.yml",
      title: "Unexpected error: internal (HTTP 500)",
      summary: [
        "An unexpected error happened in the PenguinHarness Web App.",
        "",
        "- What happened: an action failed with an unexpected error",
        "- Page: /chat/:sessionId",
      ].join("\n"),
      "system-info": "Version: v0.2.18\nInstalled as: Desktop app\nOS: macOS (arm64)",
      output: "Internal server error.",
    });
  });

  it("says unknown in the form's System info for what the host has not read yet, and leaves it out of the report", () => {
    const built = buildReport(report(), UNKNOWN_ENVIRONMENT);
    expect(fieldsOf(built.issueUrl)["system-info"]).toBe(
      "Version: unknown\nInstalled as: unknown\nOS: unknown",
    );
    expect(built.markdown).not.toContain("- OS:");
  });

  it("holds no private path, home directory or key, in the report or the link", () => {
    const leaky = report({
      facts: [["Error", "Error: ENOENT: /home/alice/acme/notes.md"]],
      output: {
        label: "Error",
        text: "at load (/Users/alice/acme/src/x.ts:1:1)\nAuthorization: Bearer sk-proj-Ab3dEf6hIj9kLm2nOp5q",
        missing: "",
      },
      privatePaths: ["/home/alice/acme"],
    });
    const built = buildReport(leaky, ENV);
    for (const shared of [built.markdown, decodeURIComponent(built.issueUrl)]) {
      expect(shared).not.toContain("alice");
      expect(shared).not.toContain("sk-proj-Ab3dEf6hIj9kLm2nOp5q");
    }
    expect(built.markdown).toContain("<workspace>/notes.md");
  });

  it("keeps a long text's link under the cap and says it was cut, while the report keeps it whole", () => {
    const long = `TypeError: x\n${"    at frame (src/a.ts:1:1)\n".repeat(400)}`;
    const built = buildReport(report({ output: { label: "Error", text: long, missing: "" } }), ENV);
    expect(built.issueUrl.length).toBeLessThanOrEqual(ISSUE_URL_CAP);
    expect(fieldsOf(built.issueUrl).output).toContain("cut short");
    expect(built.markdown).toContain(long.trim());
  });

  it("for an exception, names what happened, the page as a pattern and the error, then the stacks", () => {
    setReportRoute(() => "/org/:projectId/:orgId/chart");
    const error = new TypeError("Cannot read properties of undefined (reading 'title')");
    error.stack = `${error.name}: ${error.message}\n    at Title (/Users/alice/app/title.tsx:4:2)`;
    const built = buildReport(
      exceptionReport(error, {
        what: "the page crashed while rendering",
        componentStack: "\n    at Title\n    at Chart",
        atMs: Date.parse("2026-11-02T08:00:00.000Z"),
      }),
      ENV,
    );
    expect(built.markdown).toContain("- What happened: the page crashed while rendering");
    expect(built.markdown).toContain("- Page: /org/:projectId/:orgId/chart");
    expect(built.markdown).toContain(
      "- Error: TypeError: Cannot read properties of undefined (reading 'title')",
    );
    expect(built.markdown).toContain("- Time (UTC): 2026-11-02T08:00:00Z");
    expect(built.markdown).toContain("at Title (/Users/<user>/app/title.tsx:4:2)");
    expect(built.markdown).toContain("Component stack:\n    at Title\n    at Chart");
    expect(fieldsOf(built.issueUrl).title).toBe(
      "Unexpected error: TypeError on /org/:projectId/:orgId/chart",
    );
  });

  it("for the server's 500, names its code and status rather than a stack", () => {
    const built = buildReport(
      exceptionReport(answer(500, "internal"), { what: "an action failed", route: null }),
      ENV,
    );
    expect(built.markdown).toContain("- Error code: internal\n- HTTP status: 500");
    expect(built.markdown).not.toContain("- Page:");
  });
});

describe("where a report says it ran", () => {
  it.each<[{ channel: "release" | "source"; desktopMode: boolean }, string]>([
    [{ channel: "source", desktopMode: true }, "source"],
    [{ channel: "release", desktopMode: true }, "desktop"],
    [{ channel: "release", desktopMode: false }, "server"],
  ])("%o is installed as %s", (server, kind) => {
    expect(installKindOf(server)).toBe(kind);
  });

  it("names an OS as people name it", () => {
    expect(osName({ platform: "darwin", arch: "arm64" })).toBe("macOS (arm64)");
    expect(osName({ platform: "win32", arch: "x64" })).toBe("Windows (x64)");
    expect(osName({ platform: "freebsd", arch: "x64" })).toBe("freebsd (x64)");
  });
});
