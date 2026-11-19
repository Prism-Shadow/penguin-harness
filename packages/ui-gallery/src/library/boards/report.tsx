/**
 * 报告问题: the problem report kit — the notice a crashed part of the page shows, a failure's
 * toast that offers 「[报告问题]」 beside a refusal's that does not, inline failures (a danger
 * line, a notice's body, a field's error, a failure the app was told about with its words left
 * out) beside an input error, the could-not-load notice with the entry, and the report dialog
 * itself, opened in a demo environment.
 */
import { useEffect } from "react";
import type { Failure } from "@prismshadow/penguin-ui";
import {
  Button,
  CrashNotice,
  FailureText,
  Field,
  Input,
  LoadFailed,
  Notice,
  exceptionReport,
  openReport,
  reportFor,
  setReportEnvironment,
  setReportRoute,
  toastError,
  toldReport,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** A crash as a real one reads: its stack runs through someone's home directory, which the report takes out. */
function demoCrash(): Error {
  const error = new TypeError("Cannot read properties of undefined (reading 'title')");
  error.stack = [
    "TypeError: Cannot read properties of undefined (reading 'title')",
    "    at SessionTitle (/Users/alice/penguin-harness/packages/web/src/features/chat/session-title.tsx:42:18)",
    "    at renderWithHooks (/Users/alice/penguin-harness/node_modules/react-dom/cjs/react-dom.development.js:15486:18)",
  ].join("\n");
  return error;
}

/** The server's converged 500, shaped as the app's API error is. */
function demoInternal(): Error & { status: number; code: string } {
  return Object.assign(new Error("Internal server error."), { status: 500, code: "internal" });
}

/** A 502 the server named: a machine that did not answer. A failure, though the server expected it. */
function demoUnanswered(): Error & { status: number; code: string } {
  return Object.assign(new Error("The machine did not answer."), {
    status: 502,
    code: "machine_unanswered",
  });
}

const COMPONENT_STACK = "\n    at SessionTitle\n    at ChatHeader\n    at ChatPage";

export function ReportBoard() {
  const { S } = useGallery();
  const t = S.library.report;
  // A demo environment and page, as the app sets them at its root.
  useEffect(() => {
    setReportEnvironment({ version: "v0.2.18", install: "desktop", os: "macOS (arm64)" });
    setReportRoute(() => "/chat/:sessionId");
    return () => setReportRoute(null);
  }, []);
  const internalReport = () => exceptionReport(demoInternal(), { what: "an action failed" });
  const failed = (text: string, error: unknown): Failure => ({
    text,
    report: reportFor(error, { what: "an action failed" }),
  });
  // A machine job told the page it failed: the report names the step and the reason code, and
  // leaves ssh's words out, since they name the host, the account and the key it tried.
  const told: Failure = {
    text: t.inlineTold,
    report: toldReport({
      what: "a machine job failed",
      code: "auth",
      facts: [["Step", "connect"]],
    }),
  };
  return (
    <div className="gf-board">
      <BoardGroup title={t.crash} aside={t.crashHint}>
        <div className="lib-box" style={{ maxWidth: "46rem", height: "10rem" }}>
          <CrashNotice error={demoCrash()} componentStack={COMPONENT_STACK} onReload={noop} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.toast} aside={t.toastHint}>
        <div className="lib-row">
          <Button
            variant="danger"
            onClick={() => toastError(t.seriousText, { report: internalReport })}
          >
            {t.fireSerious}
          </Button>
          <Button onClick={() => toastError(t.expectedText)}>{t.fireExpected}</Button>
        </div>
      </BoardGroup>
      <BoardGroup title={t.inline} aside={t.inlineHint}>
        <div className="lib-stack" style={{ maxWidth: "46rem" }}>
          <p className="text-sm text-tone-danger-fg">
            <FailureText failure={failed(t.inlineLine, demoUnanswered())} />
          </p>
          <Notice tone="danger" role="alert">
            <FailureText failure={failed(t.inlineNotice, demoInternal())} />
          </Notice>
          <Field
            label={t.inlineName}
            error={<FailureText failure={failed(t.inlineSaveFailed, demoInternal())} />}
          >
            <Input size="sm" invalid defaultValue="Research" />
          </Field>
          <Input size="sm" label={t.inlineName} error={t.inlineRefused} defaultValue="Research" />
          <p className="text-sm text-tone-danger-fg">
            <FailureText failure={told} />
          </p>
        </div>
      </BoardGroup>
      <BoardGroup title={t.loadFailed} aside={t.loadFailedHint}>
        <div className="lib-stack" style={{ maxWidth: "46rem" }}>
          <div className="lib-box">
            <LoadFailed
              title={t.loadTitle}
              description={t.seriousText}
              action={{ label: t.retry, onClick: noop }}
              report={() =>
                exceptionReport(demoInternal(), {
                  what: "the conversation's history could not be loaded",
                })
              }
            />
          </div>
          <div className="lib-box">
            <LoadFailed
              title={t.loadTitle}
              description={t.expectedText}
              action={{ label: t.retry, onClick: noop }}
            />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.dialog} aside={t.dialogHint}>
        <div className="lib-row">
          <Button
            onClick={() =>
              openReport(
                exceptionReport(demoCrash(), {
                  what: "the page crashed while rendering",
                  componentStack: COMPONENT_STACK,
                }),
              )
            }
          >
            {t.open}
          </Button>
        </div>
      </BoardGroup>
    </div>
  );
}

function noop() {}
