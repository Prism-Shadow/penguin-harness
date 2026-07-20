# Make English the repository working language

Translated all residual non-i18n Chinese (comments, error/log messages, test titles and
fixtures, package metadata, e2e mock content) to English; Chinese remains only in i18n
catalogs, zh documents, and CJK-purpose test fixtures.

## Details

- Package metadata: `package.json` descriptions (root/server/web/landing) and the `link:cli`
  fallback echo.
- Source comments: all remaining Chinese comments, including the SQL comment set in
  `packages/server/src/db/schema.ts`.
- Hardcoded non-i18n user-facing strings (user-visible language change; error codes,
  placeholders, and limits untouched): server HTTP/validation/409 messages, schedule TOML
  validation errors, server logs, core SDK errors, CLI fallback errors, web provider
  invariants.
- Tests: all Chinese describe/it titles and language-irrelevant fixtures translated;
  assertions realigned to the new English source strings.
- e2e: mock LLM conversation content and cross-file branch markers translated consistently
  (the substring relationships the mock's `includes()` dispatch relies on are preserved);
  zh-locale UI assertions kept; `e2e/README.md` translated.
- Kept as required Chinese: zh i18n catalogs and fields (`strings.ts` dictionaries, CLI
  `i18n.ts`, `titleZh`, `short_description_zh`, the zh language-name label, `*.zh.md` docs) and
  test literals that assert zh i18n output or exercise CJK-specific behavior (display width,
  CJK id validation, title-language consistency, zh-CN e2e UI assertions).
- Known gap: web `formatTaskStats` still hardcodes zh stat-line fragments; the proper fix is
  routing them through the locale catalogs.

PR: [#5](https://github.com/Prism-Shadow/penguin-harness/pull/5) (merged 2026-07-20)
