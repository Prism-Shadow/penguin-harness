/**
 * The report dialog (src/components/overlays/report-dialog/), as it first renders; its portal is
 * replaced by an in-place render. Esc, the focus trap and the scrim are `Modal`'s, which the web
 * app's modal-focus suite drives.
 *
 * - It is a dialog named by its title, with the caller's words above the report, the report
 *   exactly as given in a read-only block named for it, and the caller's presses.
 */
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReportDialog } from "../src/components/overlays/report-dialog/report-dialog";
import type { ReportDialogProps } from "../src/components/overlays/report-dialog/report-dialog";
import { renderStatic } from "../src/testing";
import { stubDialogGlobals } from "./helpers/dialog-env";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (node: ReactNode) => node,
}));
stubDialogGlobals();

const REPORT = "- Error code: network\n- HTTP status: 503\n\n503 <overloaded> & retry";

const dialog = (props: Partial<ReportDialogProps> = {}) =>
  renderStatic(
    createElement(ReportDialog, {
      open: true,
      onClose: () => {},
      title: "Request failure details",
      description: "Most of these failures come from the provider.",
      report: REPORT,
      reportLabel: "Failure report",
      actions: createElement("button", { type: "button" }, "Copy"),
      ...props,
    }),
  );

/** Undoes the markup's escaping of the report's text. */
const unescape = (html: string) =>
  html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("the report dialog", () => {
  it("shows its words, the report exactly as given in a read-only block named for it, and the presses", () => {
    const html = dialog();
    expect(html).toContain('role="dialog"');
    expect(html).toContain(">Request failure details</h2>");
    expect(html).toContain("Most of these failures come from the provider.");
    const block = /<pre\b[^>]*aria-label="Failure report"[^>]*>([\s\S]*?)<\/pre>/.exec(html);
    expect(block).not.toBeNull();
    expect(unescape(block![1]!)).toBe(REPORT);
    expect(html).not.toMatch(/<(textarea|input)\b/);
    expect(html).toContain(">Copy</button>");
  });
});
