## What this changes

<!--
One or two sentences on what the change does and why it was needed. English, the
repository's working language. Add `Closes <full issue URL>` if it answers a report — a
bare `#N` is ambiguous here, because issues and pull requests share one numbering space.
-->

## Verification

<!--
What you ran, and what it said. Pick the narrowest evidence that would have failed without
this change; the full chain CI runs is `pnpm -r build`, `pnpm typecheck`, `pnpm test`,
`pnpm format` + `pnpm format:check`, on Node >= 24.
-->

## Checklist

- [ ] Changelog entry pair under `changelog/unreleased/` — `YYYY-MM-DD-<slug>.md` and its `.zh.md` counterpart, in the format [changelog/README.md](https://github.com/Prism-Shadow/penguin-harness/blob/main/changelog/README.md) describes.
- [ ] Docs updated where this changes documented behaviour (README, `packages/docs/content/`).
- [ ] No API key, bot token or other credential in the diff, the logs, or the screenshots.
