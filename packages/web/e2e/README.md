# Web E2E (Playwright)

Browser end-to-end tests: chat (thinking + tool approval + tool execution + second-turn
reply), the iconified stats line (cost conversion / copy reply), Traces (per-Task timeline +
legend + hover-linked highlighting), Workspace file preview (sandboxed HTML rendering, path
hidden by default). The LLM is driven by `mock-llm.mjs` (a mock Anthropic Messages SSE
endpoint) — no network access.

```sh
pnpm --filter @prismshadow/penguin-web test:e2e          # build + start the server + run the tests
SKIP_BUILD=1 pnpm --filter @prismshadow/penguin-web test:e2e   # skip the build
```

The first run requires `npx playwright install chromium`.
