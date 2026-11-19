/**
 * The report for an error the app caught — an exception a press ran into, an answer the server
 * failed with (its converged 500, a machine out of reach, an install that failed), a page that
 * crashed: what the person was doing in a sentence, the page as its route's pattern (never its
 * ids), the error's code and status or its kind and message, and, last, the server's message or
 * the stack and the components it crashed in. Every part of it is redacted on its way into the
 * report, and the paths the caller names private are replaced with `<workspace>`.
 */
import type { ErrorReport, ReportFact } from "./error-report";
import { currentReportRoute } from "./report-store";

export interface ExceptionContext {
  /** What happened, in a sentence of the report's English ("the page crashed while rendering"). */
  what: string;
  /** The page as its route's pattern; the app's own route when omitted. */
  route?: string | null;
  /** Where in the component tree a render crashed (React's component stack). */
  componentStack?: string | null;
  /** When it happened (epoch ms); now when omitted. */
  atMs?: number;
  /** Paths to keep out of the report, replaced with `<workspace>` (the Workspace, a browsed folder). */
  privatePaths?: readonly string[];
}

/** The error's kind and message, from whatever was thrown. */
function described(error: unknown): { kind: string; message: string; stack: string | null } {
  if (error instanceof Error) {
    return { kind: error.name || "Error", message: error.message, stack: error.stack ?? null };
  }
  return { kind: typeof error, message: String(error), stack: null };
}

export function exceptionReport(error: unknown, context: ExceptionContext): ErrorReport {
  const { kind, message, stack } = described(error);
  const answer = error as { status?: unknown; code?: unknown } | null;
  const fromServer =
    answer !== null &&
    typeof answer === "object" &&
    typeof answer.status === "number" &&
    typeof answer.code === "string";
  const route = context.route === undefined ? currentReportRoute() : context.route;
  const facts: ReportFact[] = [["What happened", context.what]];
  if (route !== null) facts.push(["Page", route]);
  if (fromServer) {
    facts.push(["Error code", String(answer.code)], ["HTTP status", String(answer.status)]);
  } else {
    facts.push(["Error", `${kind}: ${message.split("\n")[0] ?? ""}`]);
  }
  facts.push([
    "Time (UTC)",
    new Date(context.atMs ?? Date.now()).toISOString().replace(/\.\d+Z$/, "Z"),
  ]);
  const parts = [
    fromServer ? message : (stack ?? `${kind}: ${message}`),
    context.componentStack ? `Component stack:${context.componentStack}` : null,
  ].filter((part): part is string => part !== null && part.trim() !== "");
  const headline = fromServer ? `${String(answer.code)} (HTTP ${String(answer.status)})` : kind;
  return {
    heading: "PenguinHarness error report",
    title: `Error: ${headline}${route !== null ? ` on ${route}` : ""}`,
    intro: "An error happened in the PenguinHarness Web App.",
    facts,
    output: { label: "Error", text: parts.join("\n\n"), missing: "(no further detail)" },
    ...(context.privatePaths !== undefined ? { privatePaths: context.privatePaths } : {}),
  };
}
