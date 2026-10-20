# A perspective post on controlling context slope

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`

[中文版](2026-10-19-blog-context-slope.zh.md)

The blog gained a perspective post, in English and Chinese, "Controlling context slope is a core
job of the agent harness" (`context-slope`). It splits a request's context into an intercept (what
every request carries before any work) and a slope (what each request adds), and walks through how
progressive Skill loading, the disk-backed output cap, CLI output and MCP tool definitions move one
or the other.

## Details

- `context-slope` carries four figures drawn as inline SVG with the shared figure styles: estimated
  context size per request for a synthetic run with and without the 16,000-character output cap,
  the estimated size of each Skill content tier in the shipped library, the path of over-cap tool
  output to the context and to the recovery file, and three MCP designs side by side.
- The two charts plot numbers measured on a test fixture with the repository's prompt-cache test
  helpers; sizes are character-based estimates, not provider token counts.
- The landing blog test lists the post first among the perspectives.
