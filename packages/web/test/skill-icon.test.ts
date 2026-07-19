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
  it("干净的 SVG 放行（trim 后原样返回，供内联渲染继承 currentColor）", () => {
    expect(sanitizeSkillIcon(CLEAN)).toBe(CLEAN);
    expect(sanitizeSkillIcon(`\n  ${CLEAN}\n`)).toBe(CLEAN);
  });

  it("缺失 / 空串 / 空白回退 null", () => {
    expect(sanitizeSkillIcon(undefined)).toBeNull();
    expect(sanitizeSkillIcon("")).toBeNull();
    expect(sanitizeSkillIcon("   ")).toBeNull();
  });

  it("非 <svg> 根拒绝（含伪装成文本的任意 HTML）", () => {
    expect(sanitizeSkillIcon("<div>not svg</div>")).toBeNull();
    expect(sanitizeSkillIcon("plain text")).toBeNull();
    expect(sanitizeSkillIcon(`<img src=x>${CLEAN}`)).toBeNull();
    // <svgfoo…> is not an <svg> root (the tag name must end with whitespace or >).
    expect(sanitizeSkillIcon('<svgfoo viewBox="0 0 24 24"></svgfoo>')).toBeNull();
  });

  it("含 <script 拒绝（大小写不敏感）", () => {
    expect(sanitizeSkillIcon("<svg><script>alert(1)</script></svg>")).toBeNull();
    expect(sanitizeSkillIcon('<svg><SCRIPT href="x"/></svg>')).toBeNull();
  });

  it("含事件属性（on*=）拒绝", () => {
    expect(sanitizeSkillIcon('<svg onload="alert(1)"><path d="M0 0" /></svg>')).toBeNull();
    expect(sanitizeSkillIcon('<svg><path d="M0 0" onclick="x()" /></svg>')).toBeNull();
    expect(sanitizeSkillIcon('<svg><path d="M0 0" ONLOAD = "x()" /></svg>')).toBeNull();
  });

  it("含 foreignObject / xlink:href 拒绝", () => {
    expect(sanitizeSkillIcon("<svg><foreignObject><div>x</div></foreignObject></svg>")).toBeNull();
    expect(sanitizeSkillIcon('<svg><use xlink:href="#evil" /></svg>')).toBeNull();
  });

  it("任何 href 属性拒绝（不限 xlink:，大小写不敏感，单双引号/无引号形态）", () => {
    expect(
      sanitizeSkillIcon('<svg><a href="javascript:alert(1)"><path d="M0 0" /></a></svg>'),
    ).toBeNull();
    expect(sanitizeSkillIcon('<svg><use HREF="#evil" /></svg>')).toBeNull();
    expect(sanitizeSkillIcon("<svg><use href='#evil' /></svg>")).toBeNull();
    expect(sanitizeSkillIcon("<svg><a href=javascript:alert(1)>x</a></svg>")).toBeNull();
    expect(sanitizeSkillIcon('<svg><use HREF = "#evil" /></svg>')).toBeNull();
  });

  it("路径数据里的坐标不误伤（stroke=none、d 属性带负数/小数照常放行）", () => {
    const icon =
      '<svg viewBox="0 0 24 24"><path d="M2.5 3h6a4 4 0 0 1 4 4v14" fill="none" /></svg>';
    expect(sanitizeSkillIcon(icon)).toBe(icon);
  });
});
