/**
 * A failure as the Web App says it: the words, and the report 「[报告问题]」 opens when it offers
 * one (the UI package's `Failure`).
 *
 * - `failureOf(err)` is a caught error: its words are `apiErrorText`'s (or the surface's own, in
 *   `text`), and its report is offered for every failure and never for a refusal (`isReportable`).
 * - `toldFailure(text, told)` is a failure the app was told about in a result or a record (a model
 *   test, a plugin that did not load, a machine job): it always offers the report, built from what
 *   it was told.
 *
 * The `…Node` forms are the same as a node for an inline surface: the words alone for a refusal,
 * the words and 「[报告问题]」 after them for a failure (`FailureText`). The page and the time are
 * read when the failure is made, so make it when it happens (in the catch, the setter), not when
 * it is drawn.
 */
import type { ReactNode } from "react";
import { FailureText, reportFor, toldReport } from "@prismshadow/penguin-ui";
import type { Failure, ToldFailure } from "@prismshadow/penguin-ui";
import { apiErrorText } from "./api-error";

export interface FailureContext {
  /** The model a missing credential is about (apiErrorText's context). */
  modelId?: string;
  /** The words, when the surface has its own in place of apiErrorText's. */
  text?: string;
  /** What happened, for the report; "an action failed" when omitted. */
  what?: string;
  /** Paths to keep out of the report: the Workspace, a browsed directory. */
  privatePaths?: readonly string[];
}

export function failureOf(err: unknown, ctx?: FailureContext): Failure {
  return {
    text: ctx?.text ?? apiErrorText(err, ctx),
    report: reportFor(err, {
      what: ctx?.what ?? "an action failed",
      ...(ctx?.privatePaths !== undefined ? { privatePaths: ctx.privatePaths } : {}),
    }),
  };
}

/** The same as a node: the words alone for a refusal, `FailureText` for a failure. */
export function failureNode(err: unknown, ctx?: FailureContext): ReactNode {
  return <FailureText failure={failureOf(err, ctx)} />;
}

/** A failure the app was told about: its words, and the report built from what it was told. */
export function toldFailure(text: string, told: ToldFailure): Failure {
  return { text, report: toldReport(told) };
}

export function toldNode(text: string, told: ToldFailure): ReactNode {
  return <FailureText failure={toldFailure(text, told)} />;
}
