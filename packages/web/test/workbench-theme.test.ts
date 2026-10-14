/**
 * Carrying the app's appearance into a workbench's page: what is read from the app's own
 * document, and what is stamped on the frame's.
 */
import { describe, expect, it } from "vitest";
import {
  applyWorkbenchTheme,
  readAppTheme,
  WORKBENCH_THEME_HREF,
  type WorkbenchTheme,
} from "../src/lib/workbench-theme";

const appRoot = (classes: string[], fontSize: string) => ({
  classList: { contains: (t: string) => classes.includes(t) },
  style: { fontSize },
});

describe("workbench theme", () => {
  it("reads the resolved appearance rather than recomputing it", () => {
    const values: Record<string, string> = {
      "--ui-accent": " #2563eb ",
      "--color-gray-950": "#000",
      "--color-gray-100": "",
    };
    const theme = readAppTheme(appRoot(["dark"], "16px"), (p) => values[p] ?? "");
    expect(theme.dark).toBe(true);
    expect(theme.fontSize).toBe("16px");
    // Trimmed, and a property the app does not define is not stamped as an empty value.
    expect(theme.vars).toEqual({ "--ui-accent": "#2563eb", "--color-gray-950": "#000" });
  });

  it("stamps light explicitly, so the app's choice beats the system preference", () => {
    expect(readAppTheme(appRoot([], "14px"), () => "").dark).toBe(false);
  });

  it("applies classes, variables and the stylesheet exactly once", () => {
    const doc = fakeDocument();
    const theme: WorkbenchTheme = {
      dark: true,
      fontSize: "16px",
      vars: { "--ui-accent": "#2563eb" },
    };
    applyWorkbenchTheme(doc.document, theme);
    applyWorkbenchTheme(doc.document, theme);
    expect(doc.classes).toEqual({ dark: true, light: false });
    expect(doc.properties).toEqual({ "--ui-accent": "#2563eb" });
    expect(doc.root.style.fontSize).toBe("16px");
    expect(doc.links).toEqual([{ rel: "stylesheet", href: WORKBENCH_THEME_HREF }]);

    applyWorkbenchTheme(doc.document, { ...theme, dark: false });
    expect(doc.classes).toEqual({ dark: false, light: true });
    expect(doc.links).toHaveLength(1);
  });
});

/** The few DOM operations applyWorkbenchTheme performs, recorded. */
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
