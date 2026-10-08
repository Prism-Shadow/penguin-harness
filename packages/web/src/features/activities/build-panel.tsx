/**
 * The Build stage: what stands between the draft and an assembled module, checked before
 * an author presses Assemble rather than learned from a failed run, then the controls that
 * assemble it and how the last assembly went.
 *
 * The server decides the checks only it can (is the media plan current, does this ref own
 * the module code, is there a checkout); the two the page knows best (unsaved edits, a
 * waiting proposal) are added here.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type {
  ActivityRunSummary,
  ReadinessCheck,
  ReadinessLevel,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot, toneInk, type Tone } from "../../lib/tone";
import { latestModuleRun } from "./preview";

const LEVEL_TONE: Record<ReadinessLevel, Tone> = {
  ok: "success",
  warn: "attention",
  fail: "danger",
};

function checkText(check: ReadinessCheck): string {
  const words = S.activities.studioBuild;
  switch (check.id) {
    case "script":
      return words.script[check.level === "ok" ? "ok" : "warn"];
    case "spec":
      return words.spec[check.level === "ok" ? "ok" : "fail"];
    case "plan":
      return words.plan[check.state];
    case "speech":
      return words.speech(check.language, check.bound, check.total);
    case "coverage":
      return words.coverage(check.language, check.covered, check.total);
    case "media":
      return words.media(check.bound, check.total);
    case "words":
      return check.total === 0
        ? words.words.none(check.language)
        : check.level === "ok"
          ? words.words.ok(check.language, check.total)
          : words.words.missing(check.language, check.recorded, check.total, check.timed);
    case "mediaKeys":
      return check.keys.length ? words.mediaKeys.conflicting(check.keys) : words.mediaKeys.ok;
    case "assessment":
      return check.state === "valid"
        ? words.assessment.ok
        : check.state === "missing"
          ? words.assessment.missing
          : check.level === "fail"
            ? words.assessment.problems(check.problems)
            : words.assessment.inherited(check.problems);
    case "canonical":
      return words.canonical[check.level === "ok" ? "ok" : "fail"];
    case "checkout":
      return words.checkout[check.found ? "ok" : "fail"];
  }
}

function CheckRow({ level, text }: { level: ReadinessLevel; text: string }) {
  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      <span
        role="img"
        aria-label={S.activities.studioBuild.level[level]}
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${toneDot[LEVEL_TONE[level]]}`}
      />
      <span
        className={level === "ok" ? "text-gray-700 dark:text-gray-300" : toneInk[LEVEL_TONE[level]]}
      >
        {text}
      </span>
    </li>
  );
}

/**
 * What stands in the way is listed; the checks that pass fold into one line beside the title,
 * so they can still be read. While an assembly runs, "Ready to assemble" would offer a second
 * one, so the line says it is assembling instead.
 */
function BuildChecks({
  checks,
  unsaved,
  proposalOpen,
  assembling,
}: {
  checks: ReadinessCheck[];
  unsaved: boolean;
  proposalOpen: boolean;
  assembling: boolean;
}) {
  const words = S.activities.studioBuild;
  const all: { key: string; level: ReadinessLevel; text: string }[] = checks.map(
    (check, index) => ({ key: `${check.id}:${index}`, level: check.level, text: checkText(check) }),
  );
  const rows = all.filter((row) => row.level !== "ok");
  const passed = all.filter((row) => row.level === "ok");
  if (unsaved) rows.push({ key: "unsaved", level: "fail", text: words.unsaved.fail });
  if (proposalOpen) rows.push({ key: "proposal", level: "warn", text: words.proposal.warn });
  return (
    <div className="space-y-2">
      {assembling ? (
        <p className={`flex items-center gap-2 text-xs ${toneInk.busy}`}>
          <span
            aria-hidden
            className={`size-1.5 shrink-0 animate-pulse rounded-full ${toneDot.busy}`}
          />
          {words.assembling}
        </p>
      ) : (
        !rows.length && <p className={`text-xs ${toneInk.success}`}>{words.ready}</p>
      )}
      {rows.length > 0 && (
        <ul aria-label={words.title} className="divide-y divide-gray-100 dark:divide-gray-900">
          {rows.map((row) => (
            <CheckRow key={row.key} level={row.level} text={row.text} />
          ))}
        </ul>
      )}
      {passed.length > 0 && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer select-none">{words.passed(passed.length)}</summary>
          <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-900">
            {passed.map((row) => (
              <CheckRow key={row.key} level={row.level} text={row.text} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function BuildPanel({
  endpoint,
  revision,
  runs,
  unsaved,
  proposalOpen,
  children,
}: {
  endpoint: string;
  /** The draft's revision: a new one is a reason to check again. */
  revision: string;
  runs: ActivityRunSummary[];
  unsaved: boolean;
  proposalOpen: boolean;
  /**
   * The controls that assemble: reading mode, Assemble. Told whether a check has
   * failed, so Assemble is not offered until what blocks it is fixed, and whether an
   * assembly is already running, so a second one is not offered beside it.
   */
  children?: (blocked: boolean, assembling: boolean) => ReactNode;
}) {
  const words = S.activities.studioBuild;
  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRun = latestModuleRun(runs);
  // Started here or by the Assemble module stage: either way it is the one assembly running.
  const inFlight = runs.find((run) => run.kind === "module" && run.status === "running");
  const settled = !inFlight;
  useEffect(() => {
    let cancelled = false;
    // Checked once edits pause, not per keystroke.
    const timer = setTimeout(() => {
      apiFetch<{ checks: ReadinessCheck[] }>(`${endpoint}/readiness`)
        .then((value) => {
          if (cancelled) return;
          setChecks(value.checks);
          setError(null);
        })
        .catch((cause) => {
          if (!cancelled) setError(apiErrorText(cause));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [endpoint, revision, settled]);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{words.title}</h3>
      {error ? (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {words.unreadable(error)}
        </p>
      ) : !checks ? (
        <p className="text-xs text-gray-500">{words.checking}</p>
      ) : (
        <BuildChecks
          checks={checks}
          unsaved={unsaved}
          proposalOpen={proposalOpen}
          assembling={!!inFlight}
        />
      )}
      {children?.(!!checks?.some((check) => check.level === "fail"), !!inFlight)}
      <p className="text-xs text-gray-500">
        {lastRun ? (
          <>
            {words.lastRun(
              S.activities.status[lastRun.status],
              new Date(lastRun.finishedAt ?? lastRun.createdAt).toLocaleString(),
            )}{" "}
            {lastRun.inputRevision !== revision && `${words.olderDraft} `}
            {lastRun.sessionId && (
              <Link
                to={`/chat/${encodeURIComponent(lastRun.sessionId)}`}
                className="text-brand-600 hover:text-brand-700 dark:text-brand-300"
              >
                {words.openSession}
              </Link>
            )}
          </>
        ) : inFlight ? (
          words.noFinishedRun
        ) : (
          words.noRun
        )}
      </p>
    </section>
  );
}
