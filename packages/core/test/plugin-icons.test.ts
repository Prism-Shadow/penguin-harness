/**
 * Icons as images: what a file has to be to count as an icon, and how an install writes one and a
 * listing reads it back. Every place that shows an icon draws it from these, so a file refused
 * here never reaches a page.
 *
 * - Given each of the six formats (SVG, PNG, JPEG, WebP, GIF, AVIF), when its bytes are checked
 *   under a name of that format, then it is that format; an SVG may open with a byte-order mark,
 *   an XML declaration and comments before its `<svg` root.
 * - Given bytes of one format under the name of another (a PNG named `.jpg`, an SVG named `.png`,
 *   text named `.png`, a HEIC named `.avif`), or a name of no icon format, then it is refused.
 * - Given an icon over 256 KB, then it is refused.
 * - Given an SVG whose every paint is `currentColor` or `none`, then it is marked to take the text
 *   colour; given one that names another colour, a gradient, or no paint at all, then it is not.
 * - Given an SVG with script, an event handler, an animation or a link, then it is refused.
 * - Given a Skill installed with a PNG icon over an install that wrote `icon.svg`, then the
 *   directory holds `icon.png` and no `icon.svg`, and the listing reads the PNG back; an auxiliary
 *   file named like an icon is not written beside it.
 * - Given an install written before icons came in other formats (an `icon.svg` beside SKILL.md),
 *   or a hook package carrying `icon.webp`, then the listing reads that file as the icon; given an
 *   icon file that will not do, or a symlink out of the directory, then the entry lists without an
 *   icon.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  hooksDir,
  iconImage,
  installHook,
  installSkill,
  listInstalledHooks,
  listInstalledSkills,
  skillsDir,
} from "../src/index.js";

const utf8 = (text: string) => new TextEncoder().encode(text);
const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...utf8(p)] : p)));

const PNG = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR");
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], "JFIF");
const GIF = bytes("GIF89a", [1, 0, 1, 0]);
const WEBP = bytes("RIFF", [36, 0, 0, 0], "WEBPVP8 ");
const AVIF = bytes([0, 0, 0, 28], "ftypavif", [0, 0, 0, 0], "avifmif1miaf");
const HEIC = bytes([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0], "mif1heic");
const LINE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16"/></svg>';

const formatOf = (data: Uint8Array, name: string) => {
  const checked = iconImage(data, name);
  return "icon" in checked ? checked.icon.format : null;
};
const tintOf = (svg: string) => {
  const checked = iconImage(utf8(svg), "icon.svg");
  return "icon" in checked ? checked.icon.tint : null;
};

describe("an icon's format", () => {
  it.each([
    ["SVG", utf8(LINE_ICON), "icon.svg", "svg"],
    [
      "SVG after a byte-order mark, a declaration and comments",
      utf8(`﻿<?xml version="1.0"?>\n<!-- drawn by hand -->\n<!-- v2 -->\n${LINE_ICON}`),
      "logo.svg",
      "svg",
    ],
    ["PNG", PNG, "icon.png", "png"],
    ["JPEG named .jpg", JPEG, "icon.jpg", "jpeg"],
    ["JPEG named .jpeg", JPEG, "art/icon.JPEG", "jpeg"],
    ["GIF", GIF, "icon.gif", "gif"],
    ["WebP", WEBP, "icon.webp", "webp"],
    ["AVIF", AVIF, "icon.avif", "avif"],
  ])("is recognised by its bytes: %s", (_label, data, name, format) => {
    expect(formatOf(data, name)).toBe(format);
  });

  it.each([
    ["a PNG named .jpg", PNG, "icon.jpg", "is named as JPEG but its bytes are PNG"],
    ["an SVG named .png", utf8(LINE_ICON), "icon.png", "is named as PNG but its bytes are SVG"],
    ["text named .png", utf8("not an image"), "icon.png", "its bytes are no image format"],
    ["a HEIC named .avif", HEIC, "icon.avif", "its bytes are no image format"],
    ["an HTML page named .svg", utf8("<html><svg></svg></html>"), "icon.svg", "no image format"],
    ["a name of no icon format", PNG, "icon.bmp", "is not a .svg, .png"],
  ])("is refused when the name and the bytes disagree: %s", (_label, data, name, problem) => {
    const checked = iconImage(data, name);
    expect(checked).not.toHaveProperty("icon");
    expect("problem" in checked && checked.problem).toContain(problem);
  });

  it("is refused over 256 KB, whatever the format", () => {
    const large = new Uint8Array(256 * 1024 + 1);
    large.set(PNG);
    expect(iconImage(large, "icon.png")).toEqual({ problem: "is larger than 256 KB" });
    expect(formatOf(large.subarray(0, 256 * 1024), "icon.png")).toBe("png");
  });
});

describe("an SVG icon", () => {
  it.each([
    ["stroked in currentColor, unfilled", LINE_ICON],
    [
      "filled in currentColor through CSS",
      '<svg viewBox="0 0 24 24"><style>.a { fill: currentColor; stroke: none !important }</style><path class="a" d="M0 0h4"/></svg>',
    ],
    [
      "painted in a style attribute",
      `<svg viewBox="0 0 24 24" style="fill:none;stroke:CurrentColor;stroke-width:2"><path d="M0 0"/></svg>`,
    ],
  ])("takes the text colour when every paint is currentColor or none: %s", (_label, svg) => {
    expect(tintOf(svg)).toBe(true);
  });

  it.each([
    ["a second colour", LINE_ICON.replace("<path", '<path fill="#e11d48"')],
    [
      "a gradient",
      '<svg viewBox="0 0 24 24" stroke="currentColor"><path fill="url(#g)" d="M0 0"/></svg>',
    ],
    ["a colour of its own for currentColor", LINE_ICON.replace("<svg", '<svg color="red"')],
    ["no paint at all (the default black)", '<svg viewBox="0 0 24 24"><path d="M0 0h4"/></svg>'],
  ])("is drawn as itself when it carries %s", (_label, svg) => {
    expect(tintOf(svg)).toBe(false);
  });

  it.each([
    ["a script", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`],
    ["an onload handler", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`],
    [
      "an animation that rewrites a link",
      `<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="&#106;avascript:alert(1)"/><text>x</text></a></svg>`,
    ],
    [
      "a set that rewrites a link",
      `<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="#"/></a></svg>`,
    ],
    [
      "an external image",
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="//x.invalid/a"/></svg>`,
    ],
    ["an embedded page", `<svg><foreignObject><iframe/></foreignObject></svg>`],
  ])("is refused when it carries %s", (_label, svg) => {
    expect(iconImage(utf8(svg), "icon.svg")).toHaveProperty("problem");
  });
});

describe("installed icons", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-icons-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const skillDir = (name: string) =>
    path.join(skillsDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), name);
  const hookDir = (name: string) =>
    path.join(hooksDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), name);
  const skill = (name: string) => ({
    name,
    content: `---\nname: ${name}\ndescription: D.\n---\n\nBody\n`,
  });
  const skills = () => listInstalledSkills(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
  const manifest = (name: string) => ({
    name,
    description: "H.",
    version: "2026.11.09.1",
    stop: [{ command: "stop.mjs" }],
    pre_tool_use: [],
    user_prompt: [],
  });

  it("an install writes icon.<ext> for the icon's format and leaves no icon of another format", async () => {
    const svg = iconImage(utf8(LINE_ICON), "icon.svg");
    const png = iconImage(PNG, "icon.png");
    if (!("icon" in svg) || !("icon" in png)) throw new Error("fixture icons must read clean");
    await installSkill(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, {
      ...skill("notes"),
      icon: svg.icon,
    });
    await installSkill(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, {
      ...skill("notes"),
      icon: png.icon,
      // An auxiliary file named like an icon would be a second one: it is not written.
      files: { "icon.svg": LINE_ICON, "reference/icon.svg": LINE_ICON },
    });
    const files = (await fs.readdir(skillDir("notes"))).sort();
    expect(files).toEqual(["SKILL.md", "icon.png", "reference"]);
    expect((await skills())[0]!.icon).toEqual({ format: "png", bytes: PNG, tint: false });
  });

  it("a listing reads an icon.svg an earlier install wrote, and a hook package's icon.webp", async () => {
    await installSkill(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, skill("legacy"));
    await fs.writeFile(path.join(skillDir("legacy"), "icon.svg"), LINE_ICON);
    await installHook(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, manifest("goal"), {
      "stop.mjs": "export {};\n",
    });
    await fs.writeFile(path.join(hookDir("goal"), "icon.webp"), WEBP);
    expect((await skills())[0]!.icon).toMatchObject({ format: "svg", tint: true });
    const [hook] = await listInstalledHooks(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(hook!.icon).toEqual({ format: "webp", bytes: WEBP, tint: false });
  });

  it("a listing has no icon for an icon file that will not do", async () => {
    await installSkill(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, skill("scripted"));
    await fs.writeFile(
      path.join(skillDir("scripted"), "icon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    );
    expect((await skills())[0]).not.toHaveProperty("icon");
  });

  // Creating a symlink takes a privilege Windows runners do not grant.
  it.skipIf(process.platform === "win32")(
    "a listing has no icon for an icon file that links out of the directory",
    async () => {
      const secret = path.join(root, "secret.svg");
      await fs.writeFile(secret, LINE_ICON);
      await installSkill(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, skill("linked"));
      await fs.symlink(secret, path.join(skillDir("linked"), "icon.svg"));
      expect((await skills())[0]).not.toHaveProperty("icon");
    },
  );
});
