/**
 * What stands in place of a part of the page that crashed while rendering, instead of a blank
 * window: one calm line in the transcript marker's shape — 「[出错了]：这部分页面没能显示」 —
 * with 「[重新加载]」 and 「[报告问题]」 after it. The report holds the error, its stack and the
 * components it crashed in, and the page as its route's pattern; it is redacted like every report.
 *
 * `CrashBoundary` catches a crash below it and shows the notice in its place; `resetKey` changing
 * (the page navigated elsewhere) gives its children another chance. `CrashNotice` is the notice
 * alone, for a host that catches the crash itself (a data router's error element).
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { TextAction } from "../actions/text-action/text-action";
import { MessageBubble } from "../chat/message-bubble/message-bubble";
import { useUiStrings } from "../../strings";
import { exceptionReport } from "./exception-report";
import { ReportIssueAction } from "./report-action";

export function CrashNotice({
  error,
  componentStack = null,
  onReload = () => window.location.reload(),
  className = "",
}: {
  error: unknown;
  /** Where in the component tree it crashed, when the catcher knows. */
  componentStack?: string | null;
  /** What Reload does: the whole page by default. */
  onReload?: () => void;
  /** Placement: the notice fills its area and centres the line in it. */
  className?: string;
}) {
  const strings = useUiStrings().report;
  return (
    <div
      role="alert"
      data-crash-notice=""
      className={`flex h-full min-h-24 w-full items-center justify-center px-4 py-6 ${className}`}
    >
      <MessageBubble
        variant="notice"
        actions={
          <>
            <TextAction onClick={onReload}>{strings.reload}</TextAction>
            <ReportIssueAction
              report={() =>
                exceptionReport(error, { what: "the page crashed while rendering", componentStack })
              }
            />
          </>
        }
      >
        {strings.crashed}
      </MessageBubble>
    </div>
  );
}

interface CrashBoundaryProps {
  children?: ReactNode;
  /** A change gives the children another chance after a crash (the route they show). */
  resetKey?: unknown;
  /** The notice's placement. */
  className?: string;
}

interface CrashBoundaryState {
  error: unknown;
  componentStack: string | null;
  crashed: boolean;
  resetKey: unknown;
}

export class CrashBoundary extends Component<CrashBoundaryProps, CrashBoundaryState> {
  override state: CrashBoundaryState = {
    error: null,
    componentStack: null,
    crashed: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(error: unknown): Partial<CrashBoundaryState> {
    return { error, crashed: true };
  }

  static getDerivedStateFromProps(
    props: CrashBoundaryProps,
    state: CrashBoundaryState,
  ): Partial<CrashBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, crashed: false, error: null, componentStack: null };
  }

  override componentDidCatch(_error: unknown, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <CrashNotice
        error={this.state.error}
        componentStack={this.state.componentStack}
        {...(this.props.className !== undefined ? { className: this.props.className } : {})}
      />
    );
  }
}
