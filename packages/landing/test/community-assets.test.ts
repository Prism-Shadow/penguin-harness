/**
 * Where the site loads its heavy media from: the `assets/` directory of the sibling
 * Prism-Shadow/penguin-harness-community repo (lib/links.ts). The URLs are pinned to that
 * repository's layout, since nothing in this one fails when the files move there; and the two
 * scripts that fetch or stand in for the blog's pictures spell the directory out on their own, so
 * they are held to the one the renderer loads from.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blogAssetUrl, demoVideoUrl } from "../src/lib/links";

const COMMUNITY_ASSETS =
  "https://github.com/Prism-Shadow/penguin-harness-community/raw/refs/heads/main/assets";

const script = (name: string) => readFileSync(join(__dirname, "..", "scripts", name), "utf8");

describe("community media", () => {
  it("loads a blog picture from assets/blog-assets/", () => {
    expect(blogAssetUrl("agent-api-tab-en.png")).toBe(
      `${COMMUNITY_ASSETS}/blog-assets/agent-api-tab-en.png`,
    );
  });

  it("loads a demo video from assets/videos/", () => {
    expect(demoVideoUrl("decision_evo_en")).toBe(`${COMMUNITY_ASSETS}/videos/decision_evo_en.mp4`);
  });

  it("the picture scripts name the directory the renderer loads from", () => {
    const hosted = blogAssetUrl("");
    expect(script("blog-image-sizes.mjs")).toContain(`"${hosted}"`);
    const stub = /const COMMUNITY = "([^"]+)";/.exec(script("check-post-jumps.mjs"))?.[1];
    expect(stub).toBeDefined();
    expect(hosted.endsWith(stub!)).toBe(true);
  });
});
