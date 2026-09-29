/**
 * The boot status (src/components/ui/boot-pending.tsx): **while `GET /api/me` is in flight, an
 * auth guard draws a visible, announced status — never nothing.**
 *
 * Nothing means the body colour alone, which in the dark theme is pure black: a window that looks
 * like a dead app for as long as that request takes. The source scan pins both guards in
 * router.tsx, because the regression is a one-word edit (`return null`) no render test of the
 * component itself would notice.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BootPending } from "../src/components/ui/boot-pending";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const ROUTER = fileURLToPath(new URL("../src/router.tsx", import.meta.url));
const STYLES = fileURLToPath(new URL("../src/styles.css", import.meta.url));

describe("BootPending", () => {
  it("is an announced status carrying the loading text in either language", () => {
    for (const dict of [en, zh]) {
      setActiveStrings(dict);
      const html = renderToStaticMarkup(createElement(BootPending));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(dict.common.loading);
    }
  });

  it("fades in only after a delay, and holds invisible until then", () => {
    expect(renderToStaticMarkup(createElement(BootPending))).toContain("anim-boot-pending");
    const rule = /\.anim-boot-pending\s*\{([^}]*)\}/.exec(readFileSync(STYLES, "utf8"));
    expect(rule?.[1]).toMatch(/animation:\s*fade-in\s+\d+ms\s+[\w-]+\s+\d+ms\s+both;/);
  });
});

describe("the auth guards in router.tsx", () => {
  const source = readFileSync(ROUTER, "utf8");

  it("render the boot status, not nothing, while the user is unknown", () => {
    const pending = [...source.matchAll(/if \(user === undefined\) return ([^;]+);/g)].map(
      (m) => m[1],
    );
    expect(pending).toEqual(["<BootPending />", "<BootPending />"]);
  });
});
