# Tooling, language, and infrastructure

Repository language, dev commands, the changelog layout itself, and dependency upgrades.

## Make English the repository working language

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

## Reorganize the changelog by release version

The top level now holds only version folders; each version's README carries the
one-line-per-change index, and detail files live inside the folder (mirrors agenthub PR
#162).

## Details

- `changelog/<version>/README.md` is the release summary: one line per change with its
  title and one-sentence summary, linking the detail file relatively; `0.0.2/README.md`
  absorbs the section previously kept in the top-level index.
- `changelog/README.md` now documents only the layout and the entry conventions (no
  per-file listing).
- The working rules (AGENTS.md, CONTRIBUTING.md) point index updates at the version
  folder's README instead of the top-level file.

## Serialize the dev prebuild to fix concurrent dev:server / dev:web clobbering

dev:server and dev:web now share a lock-serialized, deduplicated prebuild of skills and core,
so launching both at the same time no longer corrupts dist/ (previously two tsup builds with
clean:true raced in the same output directories).

## Details

- New `scripts/dev-prebuild.mjs`: takes an exclusive on-disk lock (atomic mkdir under
  `node_modules/`) around `pnpm --filter skills --filter core build`; concurrent invocations
  wait instead of clobbering. Locks left by crashed runs are stolen when the holder PID is
  dead or the lock is older than 10 minutes.
- A 5-second success stamp collapses duplicate builds: starting dev:server and dev:web
  simultaneously builds once (the waiter skips), and dev:server's inner re-invocation is a
  no-op. The window is deliberately tiny so an edit-then-restart cycle always rebuilds —
  the "never start on stale deps" behavior is unchanged.
- Root `dev:server` now just delegates to the server package's `dev` script (which prebuilds
  via the shared script), removing the historical double build of core; `dev:web` prebuilds
  via the script and then starts Vite.
- `pnpm dev` run standalone from `packages/server` now also builds skills (it previously
  built only core, even though the server imports skills at runtime).
- Verified: concurrent invocations wait/skip correctly and release the lock; a simultaneous
  dev:server + dev:web start performs a single build with both servers coming up cleanly.

## Add a combined pnpm dev and a dev:landing shortcut

`pnpm dev` now starts the backend and the web app together with prefixed logs (workspace deps
built once via the shared prebuild lock), and `pnpm dev:landing` serves the landing page dev
server from the repo root.

## Details

- `pnpm dev` runs `concurrently -n server,web "pnpm dev:server" "pnpm dev:web"`. Merging the
  two was previously unsafe: each command prebuilt skills/core with tsup `clean: true` into
  the same dist/ directories and the parallel builds clobbered each other. The lock-serialized
  prebuild (see the serialize-dev-prebuild entry) removed that race, and its success stamp
  collapses the two prebuilds into a single build on a combined start.
- `pnpm dev:landing` delegates to the landing package's Vite dev server (port 7366, completing
  the 7364/7365/7367 dev-port family). The landing package has no workspace deps, so no
  prebuild is involved.
- `concurrently` added as a root devDependency; the dev-command lists in README.md and
  README.zh.md now cover `dev` and `dev:landing`.
- Verified: a combined start performs exactly one skills+core build (the other prebuild
  waits and skips), with the server on 127.0.0.1:7364 and Vite on localhost:7365; the
  landing dev server responds on localhost:7366. Note Vite binds localhost (IPv6 ::1) —
  use `localhost`, not `127.0.0.1`, when probing the Vite ports with curl.

## Dev commands keep pnpm install current automatically

Forgetting `pnpm install` before a dev command no longer breaks the start: every dev
command's prestep checks install freshness (lockfile-hash stamp) and runs `pnpm install`
itself when node_modules is missing or the lockfile changed.

## Details

- `scripts/dev-prebuild.mjs` gains an install-freshness step inside its existing lock: the
  pnpm-lock.yaml content hash is stamped after a successful install, so the usual dev start
  pays nothing; a fresh clone or a pulled lockfile change triggers `pnpm install`
  automatically (concurrent dev commands still install/build exactly once).
- The lock and stamps move from `node_modules/` to the OS temp directory keyed by the repo
  path — they must exist before the first install does (the old location crashed on a fresh
  clone), and per-checkout isolation comes from the key.
- `dev:docs` / `dev:landing` have no workspace deps to build but still need current
  installs: they now run the prestep with `--install-only`.

## Upgrade AgentHub to 0.4.0 and adopt the opaque fidelity payload

@prismshadow/agenthub 0.3.3 -> 0.4.0 (agenthub PR #159): content items replace the item-level
`signature`/`phase` fields with one opaque `fidelity` object, and OmniMessage now carries it
verbatim end to end — Trace, replay, and resume included; the `agenthub-dev` skill joins the
built-in library.

## Details

- OmniMessage complete payloads (text, thinking, inline_data, inline_thinking, tool_call)
  replace `signature?: string` / `phase?: string | null` with `fidelity?: Record<string,
  unknown>` — an opaque wire-fidelity payload written to the Trace as-is and passed back
  verbatim on replay (Claude thinking signatures, GPT-5 encrypted reasoning `{id,
  encrypted_content}` and `{phase}` markers, the OpenAI-compatible `{reasoning_field}` name).
  Builders take the object directly; an empty object is treated as absent.
- GenerativeModel's streaming translator mirrors AgentHub baseClient aggregation: a thinking
  block is closed by its fidelity payload and a run of equal fidelity is one block (the
  OpenAI-compatible clients stamp every thinking delta with the same `{reasoning_field}`,
  which must not split blocks — this carries agenthub's reasoning-field replay fix through
  PenguinHarness so multi-turn conversations against strict OpenAI-compatible upstreams
  survive); a text segment splits on a differing `fidelity.phase` and closes on
  `fidelity.signature`, merging fidelity keys. Text-phase stickiness across segments is gone
  (mirrors baseClient).
- The `agenthub-dev` skill (AgentHub's own model-support development workflow) is installed
  into the built-in library under the Penguin Development group, completed to the library
  contract (version/updated frontmatter, short descriptions, a "Before you start" section,
  and a custom icon).
- Malformed-classification fix for 0.4.x: agenthub now surfaces truncated streamed tool-call
  arguments as its own `ToolCallArgumentParseError` (previously a raw `SyntaxError`) and
  thinking-only completions as `EmptyResponseError`; `isMalformedJsonParseError` recognizes
  both (instanceof + name fallback + cause chain), so these still end as `malformed` and the
  engine reconnects and retries instead of failing the turn (caught by the malformed e2e).
- Docs (omni-message, interfaces, sessions-and-traces; en + zh) and the design specs updated
  to the fidelity semantics.
- Traces written before this change carried `signature`/`phase` on payloads; per the
  pre-release no-migration policy they are not converted (old fields are ignored on replay —
  resume of such Sessions loses provider fidelity; delete and recreate if needed).

## The changelog folder consolidates into topic files

One file per change had grown to 35 fragment files for this release alone; the version folder now groups changes by TOPIC — six files (models-and-catalog, web-app, landing-site, blog-and-docs, readme, tooling), each an H1 scope with one H2 per change. New changes append an H2 to the matching topic file (a new topic file only when none fits), the version README lists topics instead of entries, and the branch was rebased onto main to linearize away the merge commit with the final tree kept byte-identical.
