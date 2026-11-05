/**
 * Records the size of every picture the blog's posts show as a Markdown image, in
 * src/lib/blog-image-sizes.json, so the post page can give each `<img>` its width and height
 * before the picture arrives (MdImage in src/pages/blog-post.tsx). Without them a picture has no
 * height until it loads, and each one that loads moves everything below it: the reader's place
 * while they read, and the target of a citation, a back-link or a TOC entry while the page
 * scrolls to it.
 *
 *   node scripts/blog-image-sizes.mjs           # record the pictures not recorded yet
 *   node scripts/blog-image-sizes.mjs --check   # list the ones not recorded; exit 1 if any
 *
 * The pictures are not in this repository: `/blog-assets/<name>` is served from the community
 * repo (blogAssetUrl in src/lib/links.ts), and some posts link GitHub attachments directly. Each
 * picture not recorded yet is downloaded once and its size read from the file's own header.
 * Raw `<img>` tags carry their own `width` and `height` and are not listed. Behind a proxy, run
 * it with `NODE_USE_ENV_PROXY=1`, so Node's fetch goes through `https_proxy`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize, markdownImageSources } from "../src/lib/blog-images.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSTS = path.resolve(HERE, "../content/blog");
const MANIFEST = path.resolve(HERE, "../src/lib/blog-image-sizes.json");
const COMMUNITY_RAW =
  "https://github.com/Prism-Shadow/penguin-harness-community/raw/refs/heads/main/blog-assets/";

/** Where a post's image source is downloaded from, or null for one that is not on the web. */
const downloadUrl = (src) =>
  src.startsWith("/blog-assets/")
    ? COMMUNITY_RAW + src.slice("/blog-assets/".length)
    : /^https?:\/\//.test(src)
      ? src
      : null;

const sources = new Set();
for (const file of readdirSync(POSTS).filter((f) => f.endsWith(".md"))) {
  for (const src of markdownImageSources(readFileSync(path.join(POSTS, file), "utf8"))) {
    if (downloadUrl(src)) sources.add(src);
  }
}
const sizes = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const missing = [...sources].filter((src) => !sizes[src]).sort();

if (process.argv.includes("--check")) {
  for (const src of missing) console.log(`not recorded: ${src}`);
  console.log(`${sources.size} pictures, ${missing.length} without a recorded size`);
  process.exit(missing.length > 0 ? 1 : 0);
}

let failed = 0;
const queue = [...missing];
async function worker() {
  for (let src = queue.shift(); src; src = queue.shift()) {
    try {
      const res = await fetch(downloadUrl(src), { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const size = imageSize(new Uint8Array(await res.arrayBuffer()));
      if (!size) throw new Error("not a PNG, JPEG, GIF, WebP or SVG file");
      sizes[src] = size;
      console.log(`${size[0]}x${size[1]}  ${src}`);
    } catch (error) {
      failed++;
      console.log(`FAILED  ${src}: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

// One picture per line, in the shape Prettier keeps.
const lines = Object.keys(sizes)
  .sort()
  .map((src) => `  ${JSON.stringify(src)}: [${sizes[src][0]}, ${sizes[src][1]}]`);
writeFileSync(MANIFEST, `{\n${lines.join(",\n")}\n}\n`);
console.log(`${missing.length - failed} recorded now, ${failed} failed, ${lines.length} in all`);
process.exit(failed > 0 ? 1 : 0);
