# Web App: code highlighting drops the WASM engine and the full grammar registry

- **Date:** 2026-08-18
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#300](https://github.com/Prism-Shadow/penguin-harness/pull/300)

[中文版](2026-08-18-web-code-highlight-bundle.zh.md)

The first code block a conversation renders used to pull ~308 KB gzip of highlighter before coloring a single token; it now pulls ~69 KB.

## What changed

Chat code blocks and the workspace source view no longer import `shiki` (its full bundle) ([#300](https://github.com/Prism-Shadow/penguin-harness/pull/300)). The highlighter is assembled from `shiki/core` with an explicit language list, and the oniguruma WASM engine is replaced by Shiki's pure-JavaScript regex engine.

The full bundle's cost is not the grammars — those already load lazily, one chunk per language — it is the two things that load with the *first* block regardless of language: the WASM engine (622 KB raw / 230 KB gzip) and the registry describing all 332 bundled grammars.

Measured on this app, for a first block of TypeScript:

| | before | after |
| --- | --- | --- |
| highlighter core | 62.08 KB | 48.25 KB |
| regex engine | 230.29 KB (WASM) | — |
| themes | in core | 5.06 KB |
| `typescript` grammar | 16.04 KB | 16.04 KB |
| **first code block** | **~308 KB** | **~69 KB** |
| `dist/` total | 11 MB, 304 chunks | 3.3 MB, 29 chunks |

(gzip; the main entry chunk grows 0.85 KB, for the extension and alias tables now resolved without loading the highlighter.)

The JavaScript engine is a like-for-like swap, not an approximation: all 220,772 TextMate patterns across all 332 bundled grammars translate to JavaScript regexes with no failures, and its token output is byte-identical to oniguruma's for the languages sampled (TypeScript, C++, shell, PHP, Ruby, Python, Markdown, HTML).

## The trade

Only the languages listed in `code-languages.ts` highlight — the 23 the workspace browser maps from file extensions, plus `diff`. A fenced block in a language outside that list (`swift`, `kotlin`, …) renders as unhighlighted monospace where the full bundle would have colored it. Adding one is a single line, and the same file carries the fence aliases (` ```ts `, ` ```bash `) that decide which grammar to fetch, so a Shiki upgrade that introduces an alias needs a row there or that fence stops highlighting.

Unchanged: both themes still ship as CSS variables from one highlight pass, so light/dark switching never re-highlights; unannotated fences and unmapped file extensions still render as themed plain text; highlighting is still skipped while a message streams.
