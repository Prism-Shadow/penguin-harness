/**
 * Where reports are opened from, and what every report knows of where it ran: a module-level
 * store, as the toasts have, so any component — a toast, a load-failure notice, a crash notice —
 * opens a complete report without the app threading props down to it.
 *
 * The app sets it once at its root: the environment as it learns it (`setReportEnvironment`: the
 * version, how it is installed, the OS) and how to name the page on screen without its ids
 * (`setReportRoute`). One `ReportHost` mounted beside the toasts shows the report that is open.
 */
import { createStore } from "zustand/vanilla";
import { UNKNOWN_ENVIRONMENT } from "./error-report";
import type { ErrorReport, ReportEnvironment } from "./error-report";

interface ReportState {
  environment: ReportEnvironment;
  /** The page on screen as its route's pattern ("/chat/:sessionId"); null where none is set. */
  route: (() => string | null) | null;
  /** The report on show; null while none is. */
  open: ErrorReport | null;
}

export const reportStore = createStore<ReportState>(() => ({
  environment: UNKNOWN_ENVIRONMENT,
  route: null,
  open: null,
}));

export function setReportEnvironment(environment: ReportEnvironment): void {
  reportStore.setState({ environment });
}

export function setReportRoute(route: (() => string | null) | null): void {
  reportStore.setState({ route });
}

/** The page on screen as its route's pattern, or null when the app named no way to tell. */
export function currentReportRoute(): string | null {
  try {
    return reportStore.getState().route?.() ?? null;
  } catch {
    return null;
  }
}

export function openReport(report: ErrorReport): void {
  reportStore.setState({ open: report });
}

export function closeReport(): void {
  reportStore.setState({ open: null });
}
