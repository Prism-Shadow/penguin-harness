/**
 * Pictures in blog posts get their size before they arrive (lib/blog-images.ts,
 * lib/blog-image-sizes.json, MdImage in pages/blog-post.tsx), so a picture that loads late moves
 * nothing: not the reader's place, not the target of a jump in flight.
 *
 * - Given every post on disk, every picture it shows as a Markdown image has its size recorded.
 *   A post that adds one without recording it fails here, with the command that records it.
 * - Given a Markdown image whose size is recorded, it renders with that width and height; one
 *   written as a raw `<img>` keeps its own; one with no recorded size renders without any.
 * - Given a PNG, GIF, WebP (lossy, lossless, extended), JPEG or SVG file, its size is read from
 *   its header; anything else reads as unknown.
 * - Given a post's text, every Markdown image's source is found, titled or in angle brackets, and
 *   links and raw tags are not counted.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { imageSize, markdownImageSources } from "../src/lib/blog-images";
import sizes from "../src/lib/blog-image-sizes.json";
import { PostBody } from "../src/pages/blog-post";

const POSTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../content/blog");
const RECORDED: Record<string, number[] | undefined> = sizes;
const render = (body: string) => renderToStaticMarkup(createElement(PostBody, { body }));
const imgTag = (html: string) => /<img\b[^>]*>/.exec(html)?.[0] ?? "";

describe("pictures in blog posts", () => {
  it("records the size of every picture a post shows", () => {
    const missing = readdirSync(POSTS)
      .filter((file) => file.endsWith(".md"))
      .flatMap((file) =>
        markdownImageSources(readFileSync(path.join(POSTS, file), "utf8"))
          .filter((src) => /^(\/blog-assets\/|https?:\/\/)/.test(src) && !RECORDED[src])
          .map((src) => `${file}: ${src}`),
      );
    // Record them with `node packages/landing/scripts/blog-image-sizes.mjs` (it downloads them).
    expect(missing).toEqual([]);
  });

  it("renders a recorded picture at its size, and leaves the others as written", () => {
    const [src = "", [width, height] = []] = Object.entries(RECORDED)[0] ?? [];
    const recorded = imgTag(render(`![A screenshot](${src})`));
    expect(recorded).toContain(`width="${width}"`);
    expect(recorded).toContain(`height="${height}"`);

    const raw = imgTag(render(`<img src="${src}" alt="" width="10" height="20" />`));
    expect(raw).toContain('width="10"');
    expect(raw).toContain('height="20"');

    const unknown = imgTag(render("![A screenshot](/blog-assets/not-recorded-anywhere.png)"));
    expect(unknown).not.toMatch(/\b(width|height)=/);
  });

  it.each([
    [
      "PNG",
      [
        0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 7, 128, 0, 0, 4,
        56,
      ],
      [1920, 1080],
    ],
    ["GIF", [71, 73, 70, 56, 57, 97, 0x40, 0x01, 0xc8, 0x00], [320, 200]],
    [
      "lossy WebP",
      [...riff("VP8 "), 0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 0x03, 0x58, 0x02],
      [800, 600],
    ],
    ["lossless WebP", [...riff("VP8L"), 0x2f, ...le32(799 | (599 << 14))], [800, 600]],
    [
      "extended WebP",
      [...riff("VP8X"), 0, 0, 0, 0, 0x1f, 0x03, 0x00, 0x57, 0x02, 0x00],
      [800, 600],
    ],
    [
      "JPEG",
      [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3],
      [800, 600],
    ],
  ])("reads a %s file's size from its header", (_kind, bytes, size) => {
    expect(imageSize(Uint8Array.from([...bytes, ...new Array(16).fill(0)]))).toEqual(size);
  });

  it("reads an SVG's size from its attributes or its view box, and nothing from other files", () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(
      imageSize(text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 344">')),
    ).toEqual([560, 344]);
    expect(imageSize(text('<svg width="100" height="50px" viewBox="0 0 10 5">'))).toEqual([
      100, 50,
    ]);
    expect(imageSize(text("not a picture at all, just words"))).toBeNull();
  });

  it("finds every Markdown image's source, and nothing else", () => {
    const text = [
      '![One](/blog-assets/a.png) and ![Two](/blog-assets/b.webp "A title")',
      "![Three](<https://github.com/user-attachments/assets/x>)",
      '[a link](/blog/other) and <img src="/blog-assets/raw.png" width="1" height="1" />',
    ].join("\n");
    expect(markdownImageSources(text)).toEqual([
      "/blog-assets/a.png",
      "/blog-assets/b.webp",
      "https://github.com/user-attachments/assets/x",
    ]);
  });
});

/** A RIFF/WEBP header up to the first chunk's payload. */
function riff(chunk: string): number[] {
  return [..."RIFF"]
    .map((c) => c.charCodeAt(0))
    .concat(
      [0, 0, 0, 0],
      [..."WEBP"].map((c) => c.charCodeAt(0)),
      [...chunk].map((c) => c.charCodeAt(0)),
      [0, 0, 0, 0],
    );
}

function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
