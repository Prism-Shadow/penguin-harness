/**
 * 报告问题: the problem report kit — the notice a crashed part of the page shows, an error toast
 * that offers 「[报告问题]」 beside one that does not (an expected error), the could-not-load notice
 * with the entry, and the report dialog itself, opened in a demo environment.
 */
import { useEffect } from "react";
import {
  Button,
  CrashNotice,
  LoadFailed,
  exceptionReport,
  openReport,
  setReportEnvironment,
  setReportRoute,
  toastError,
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
  const internalReport = () =>
    exceptionReport(demoInternal(), { what: "an action failed with an unexpected error" });
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
