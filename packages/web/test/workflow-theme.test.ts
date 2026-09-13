/**
 * Carrying the app's appearance into a workflow's page: what is read from the app's own
 * document, and what is stamped on the frame's.
 */
import { describe, expect, it } from "vitest";
import {
  applyWorkflowTheme,
  readAppTheme,
  WORKFLOW_THEME_HREF,
  type WorkflowTheme,
} from "../src/lib/workflow-theme";

const appRoot = (classes: string[], fontSize: string) => ({
  classList: { contains: (t: string) => classes.includes(t) },
  style: { fontSize },
});

describe("workflow theme", () => {
  it("reads the resolved appearance rather than recomputing it", () => {
    const values: Record<string, string> = {
      "--accent-bg": " #2563eb ",
      "--color-gray-950": "#000",
      "--color-gray-100": "",
    };
    const theme = readAppTheme(appRoot(["dark"], "16px"), (p) => values[p] ?? "");
    expect(theme.dark).toBe(true);
    expect(theme.fontSize).toBe("16px");
    // Trimmed, and a property the app does not define is not stamped as an empty value.
    expect(theme.vars).toEqual({ "--accent-bg": "#2563eb", "--color-gray-950": "#000" });
  });

  it("stamps light explicitly, so the app's choice beats the system preference", () => {
    expect(readAppTheme(appRoot([], "14px"), () => "").dark).toBe(false);
  });

  it("applies classes, variables and the stylesheet exactly once", () => {
    const doc = fakeDocument();
    const theme: WorkflowTheme = {
      dark: true,
      fontSize: "16px",
      vars: { "--accent-bg": "#2563eb" },
    };
    applyWorkflowTheme(doc.document, theme);
    applyWorkflowTheme(doc.document, theme);
    expect(doc.classes).toEqual({ dark: true, light: false });
    expect(doc.properties).toEqual({ "--accent-bg": "#2563eb" });
    expect(doc.root.style.fontSize).toBe("16px");
    expect(doc.links).toEqual([{ rel: "stylesheet", href: WORKFLOW_THEME_HREF }]);

    applyWorkflowTheme(doc.document, { ...theme, dark: false });
    expect(doc.classes).toEqual({ dark: false, light: true });
    expect(doc.links).toHaveLength(1);
  });
});

/** The few DOM operations applyWorkflowTheme performs, recorded. */
function fakeDocument() {
  const classes: Record<string, boolean> = {};
  const properties: Record<string, string> = {};
  const links: Array<{ rel: string; href: string }> = [];
  const root = {
    classList: { toggle: (token: string, on: boolean) => void (classes[token] = on) },
    style: { fontSize: "", setProperty: (n: string, v: string) => void (properties[n] = v) },
  };
  const head = {
    querySelector: (selector: string) => links.find((l) => selector.includes(l.href)) ?? null,
    prepend: (link: { rel: string; href: string }) => void links.unshift(link),
  };
  const document = {
    documentElement: root,
    head,
    createElement: () => ({ rel: "", href: "" }),
  } as unknown as Document;
  return { document, root, classes, properties, links };
}
