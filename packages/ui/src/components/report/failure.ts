/**
 * A failure as a surface says it: its words, and the report 「[报告问题]」 opens when it offers one.
 *
 * Two ways a surface learns that something failed, and a report for each:
 *
 * - it caught an error (an answer the server failed with, an exception): `reportFor` gives the
 *   report when the rule says it is a failure (`isReportable`), and null for a refusal, which
 *   offers none;
 * - it was told, in a result or a record that says something failed (a model test, a plugin that
 *   did not load, a machine job): `toldReport` builds the report from what it was told — what
 *   happened, its code, and the failure's own words when they are safe to share.
 *
 * Either way the page and the time are read now, when it failed, and the report is built when it
 * is opened.
 */
import type { ErrorReport, ReportFact } from "./error-report";
import { exceptionReport } from "./exception-report";
import type { ExceptionContext } from "./exception-report";
import { isReportable } from "./reportable";
import { currentReportRoute } from "./report-store";

/** A failure as a surface says it: its words, and its report when it offers one. */
export interface Failure {
  /** The failure in the interface's words. */
  text: string;
  /** Opened from 「[报告问题]」 after the words; null for a refusal, which offers none. */
  report: ErrorReport | (() => ErrorReport) | null;
}

/** When it happened, as a report says it. */
function utc(atMs: number): string {
  return new Date(atMs).toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * The report a caught error offers, or null when it is a refusal (`isReportable`). The page and
 * the time are read now, when it failed; the report is built when it is opened.
 */
export function reportFor(error: unknown, context: ExceptionContext): (() => ErrorReport) | null {
  if (!isReportable(error)) return null;
  const fixed: ExceptionContext = {
    ...context,
    route: context.route === undefined ? currentReportRoute() : context.route,
    atMs: context.atMs ?? Date.now(),
  };
  return () => exceptionReport(error, fixed);
}

/** A failure the app was told about, not one it caught: a result or a record that says it failed. */
export interface ToldFailure {
  /** What happened, in a sentence of the report's English ("a plugin failed to load"). */
  what: string;
  /** Its machine-readable code, when it has one. */
  code?: string;
  /**
   * The failure's own words: a server's or a provider's message, an installer's output; null
   * when it came with none. Omit it for words about the person's own machines or content (ssh's
   * output, an MCP server's error): the report then says they were left out.
   */
  detail?: string | null;
  /** Further named facts, in English (the provider and the model, a step, a package). */
  facts?: readonly ReportFact[];
  /** Strings that look random but are safe and useful (a request id). */
  keep?: readonly string[];
  /** Paths to keep out of the report (`<workspace>`). */
  privatePaths?: readonly string[];
}

/** What stands in a told failure's report where its words were left out. */
const LEFT_OUT = "(left out: it can name hosts, accounts or commands; add what is needed by hand)";

/** What stands in a told failure's report when it came with no words. */
const NO_WORDS = "(no further detail)";

/**
 * The report for a failure the app was told about: what happened, the page, its code, the
 * caller's facts and the time, then the failure's own words, or a line saying they were left out.
 * The page and the time are read now; the report is built when it is opened.
 */
export function toldReport(told: ToldFailure): () => ErrorReport {
  const route = currentReportRoute();
  const atMs = Date.now();
  return () => {
    const facts: ReportFact[] = [["What happened", told.what]];
    if (route !== null) facts.push(["Page", route]);
    if (told.code !== undefined) facts.push(["Error code", told.code]);
    facts.push(...(told.facts ?? []), ["Time (UTC)", utc(atMs)]);
    return {
      heading: "PenguinHarness error report",
      title: `Failure: ${told.code ?? told.what}${route !== null ? ` on ${route}` : ""}`,
      intro: "Something failed in the PenguinHarness Web App.",
      facts,
      output: {
        label: "Error",
        text: told.detail ?? null,
        missing: told.detail === undefined ? LEFT_OUT : NO_WORDS,
      },
      ...(told.keep !== undefined ? { keep: told.keep } : {}),
      ...(told.privatePaths !== undefined ? { privatePaths: told.privatePaths } : {}),
    };
  };
}
