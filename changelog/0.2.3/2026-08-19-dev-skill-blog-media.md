# The dev skill records where blog images live

- **Date:** 2026-08-19
- **Type:** process
- **Scope:** `skills`

[中文版](2026-08-19-dev-skill-blog-media.zh.md)

`.agents/skills/penguin-harness-dev/SKILL.md` gained a "Blog posts, and where their images live" section covering the post pair under `packages/landing/content/blog/`, the community repo that hosts the images, the `/blog-assets/<name>` path posts write instead of the host URL, and how release screenshots are captured.

## Details

- Screenshots and demo videos live in the sibling `Prism-Shadow/penguin-harness-community` repo under `blog-assets/` and `videos/`, not in this one; the section states why, so the arrangement is not undone by someone who reads it as an accident.
- Posts reference `/blog-assets/<name>`, resolved at render time by `blogAssetUrl` in `packages/landing/src/lib/links.ts` and the `img` adapter in `src/pages/blog-post.tsx`. Pasting a raw host URL into a post is called out as the thing not to do.
- Release screenshots are driven through the Playwright e2e harness with its mock LLM against a scratch `PENGUIN_HOME`, at `deviceScaleFactor: 2`, with a frame check for home-directory paths, API keys and mock-model filler.
- The skill's frontmatter description now names blog posts and screenshots among its triggers.
