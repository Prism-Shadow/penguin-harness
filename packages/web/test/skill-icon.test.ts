/**
 * sanitizeSkillIcon unit tests: security checks before inline rendering of a
 * custom Skill icon (raw icon.svg content) — anything containing <script,
 * event attributes (on*=), foreignObject, or any href attribute (not limited
 * to xlink:, case-insensitive, quoted/unquoted forms) is rejected (falls back
 * to the default book icon); a non-<svg> root / missing content is also
 * rejected; a clean line-art SVG passes through as-is (after trim).
 */
import { describe, expect, it } from "vitest";
import { sanitizeSkillIcon } from "../src/features/skills/skill-icon";

const CLEAN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">' +
  '<path d="M4 4h16v16H4z" /></svg>';

describe("sanitizeSkillIcon", () => {
  it("a clean SVG passes (returned as-is after trim so inline rendering inherits currentColor)", () => {
    expect(sanitizeSkillIcon(CLEAN)).toBe(CLEAN);
    expect(sanitizeSkillIcon(`\n  ${CLEAN}\n`)).toBe(CLEAN);
  });

  it("missing / empty string / whitespace falls back to null", () => {
    expect(sanitizeSkillIcon(undefined)).toBeNull();
    expect(sanitizeSkillIcon("")).toBeNull();
    expect(sanitizeSkillIcon("   ")).toBeNull();
  });

  it("a non-<svg> root is rejected (including arbitrary HTML posing as text)", () => {
    expect(sanitizeSkillIcon("<div>not svg</div>")).toBeNull();
    expect(sanitizeSkillIcon("plain text")).toBeNull();
    expect(sanitizeSkillIcon(`<img src=x>${CLEAN}`)).toBeNull();
    // <svgfoo…> is not an <svg> root (the tag name must end with whitespace or >).
    expect(sanitizeSkillIcon('<svgfoo viewBox="0 0 24 24"></svgfoo>')).toBeNull();
  });

  it("containing <script is rejected (case-insensitive)", () => {
    expect(sanitizeSkillIcon("<svg><script>alert(1)</script></svg>")).toBeNull();
    expect(sanitizeSkillIcon('<svg><SCRIPT href="x"/></svg>')).toBeNull();
  });

  it("event attributes (on*=) are rejected", () => {
    expect(sanitizeSkillIcon('<svg onload="alert(1)"><path d="M0 0" /></svg>')).toBeNull();
    expect(sanitizeSkillIcon('<svg><path d="M0 0" onclick="x()" /></svg>')).toBeNull();
    expect(sanitizeSkillIcon('<svg><path d="M0 0" ONLOAD = "x()" /></svg>')).toBeNull();
  });

  it("foreignObject / xlink:href are rejected", () => {
    expect(sanitizeSkillIcon("<svg><foreignObject><div>x</div></foreignObject></svg>")).toBeNull();
    expect(sanitizeSkillIcon('<svg><use xlink:href="#evil" /></svg>')).toBeNull();
  });

  it("any href attribute is rejected (not just xlink:, case-insensitive, single/double/unquoted forms)", () => {
    expect(
      sanitizeSkillIcon('<svg><a href="javascript:alert(1)"><path d="M0 0" /></a></svg>'),
    ).toBeNull();
    expect(sanitizeSkillIcon('<svg><use HREF="#evil" /></svg>')).toBeNull();
    expect(sanitizeSkillIcon("<svg><use href='#evil' /></svg>")).toBeNull();
    expect(sanitizeSkillIcon("<svg><a href=javascript:alert(1)>x</a></svg>")).toBeNull();
    expect(sanitizeSkillIcon('<svg><use HREF = "#evil" /></svg>')).toBeNull();
  });

  it("coordinates in path data are not false positives (stroke=none and d attributes with negatives/decimals still pass)", () => {
    const icon =
      '<svg viewBox="0 0 24 24"><path d="M2.5 3h6a4 4 0 0 1 4 4v14" fill="none" /></svg>';
    expect(sanitizeSkillIcon(icon)).toBe(icon);
  });
});
