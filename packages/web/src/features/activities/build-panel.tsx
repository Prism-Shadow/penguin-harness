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

export function BuildPanel({
  endpoint,
  revision,
  wafRoot,
  runs,
  unsaved,
  proposalOpen,
  children,
}: {
  endpoint: string;
  /** The draft's revision: a new one is a reason to check again. */
  revision: string;
  wafRoot: string;
  runs: ActivityRunSummary[];
  unsaved: boolean;
  proposalOpen: boolean;
  /**
   * The controls that assemble: checkout, reading mode, Assemble. Told whether a check has
   * failed, so Assemble is not offered until what blocks it is fixed.
   */
  children?: (blocked: boolean) => ReactNode;
}) {
  const words = S.activities.studioBuild;
  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRun = latestModuleRun(runs);
  const settled = lastRun?.status !== "running";
  useEffect(() => {
    let cancelled = false;
    // A path typed into the checkout field is checked once typing pauses, not per key.
    const timer = setTimeout(() => {
      const query = wafRoot.trim() ? `?${new URLSearchParams({ wafRoot: wafRoot.trim() })}` : "";
      apiFetch<{ checks: ReadinessCheck[] }>(`${endpoint}/readiness${query}`)
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
  }, [endpoint, revision, wafRoot, settled]);

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
        <ul aria-label={words.title} className="divide-y divide-gray-100 dark:divide-gray-900">
          {checks.map((check, index) => (
            <CheckRow key={`${check.id}:${index}`} level={check.level} text={checkText(check)} />
          ))}
          <CheckRow level={unsaved ? "fail" : "ok"} text={words.unsaved[unsaved ? "fail" : "ok"]} />
          <CheckRow
            level={proposalOpen ? "warn" : "ok"}
            text={words.proposal[proposalOpen ? "warn" : "ok"]}
          />
        </ul>
      )}
      {children?.(!!checks?.some((check) => check.level === "fail"))}
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
        ) : (
          words.noRun
        )}
      </p>
    </section>
  );
}
