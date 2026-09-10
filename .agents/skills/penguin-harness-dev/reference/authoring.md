# Authoring: blog posts, prose hygiene, and proposing simplifications

Loaded on demand from `SKILL.md`. Three things that come up when you are writing rather than
changing behavior.

## Blog posts, and where their images live

A post is a pair under `packages/landing/content/blog/`: `<slug>.en.md` and `<slug>.zh.md`, each
with `title` / `date` / `category` / `excerpt` frontmatter. Same rule as changelog entries — one
without the other is unfinished.

**The images are not in this repo.** Screenshots and demo videos live in the sibling
`Prism-Shadow/penguin-harness-community` repo, under `blog-assets/` and `videos/`. A published
post's screenshots are never deleted, so that asset class grows without bound in the number of
posts written; keeping it out of this history keeps everyone's clone small.

**Posts still write a repo-local path.** Reference an image as `/blog-assets/<name>` — both
`![alt](…)` and the raw `<img src="…">` some posts use — and let the renderer resolve it:
`blogAssetUrl` in `packages/landing/src/lib/links.ts`, applied by the `img` adapter in
`src/pages/blog-post.tsx`. Never paste the raw `raw.githubusercontent` URL into a post. One source
of truth for the host, Markdown that stays readable and diffable, and moving the host again is a
one-line change instead of a sweep over every post.

Release screenshots are captured, not mocked up: drive the app through the Playwright e2e harness
in `packages/web/e2e/` with its mock LLM, against a scratch `PENGUIN_HOME` — never `~/.penguin`,
which is the developer's real data. Shoot at `deviceScaleFactor: 2`, crop to the feature rather
than the whole window, and check the frame for what must not ship publicly: absolute paths carrying
a home directory, API keys, and mock-model filler text.

## Prose that survives the session

Comments, JSDoc, docs and changelog entries are read by people who have no access to the session
that produced them. Apply one test to any suspect passage:

> Could a reader at HEAD, with no session transcript and no uncommitted draft, resolve every
> reference and verify every claim?

If not, keep the surviving facts and delete the rest. What to hunt:

- **Dead citations** — design-session decision numbers, `§N` of an uncommitted draft, audit item
  codes. This repo already swept design-doc citations out of code comments once; do not reintroduce
  them.
- **Stack and review vantage** — "a later PR in this stack", "rejected in review", "the reviewer
  confirmed". State the shipped mechanism; drop the choreography.
- **Change narration** — "used to", "no longer", "this cut". A comment describes what the code does
  now. A changelog entry describes what the change did, in past tense — that is the one place
  narration is correct.
- **Reviewer-addressed justification** — defensive paragraphs arguing a choice was fine. State the
  invariant, or delete.
- **Hedged planning residue** — "probably fine for now". Promote to a real `TODO` with a name, or
  replace with the actual bound.
- **Authoring-language slips** — untranslated fragments. Non-i18n code and developer docs are
  English-only; Chinese belongs in i18n catalogs, `*.zh.md` documents, and tests asserting CJK
  behavior.

Keep, deliberately: issue and merged-PR links, suppression justifications, counterfactual-present
statements ("without this, X happens"), measured bounds and the numbers behind them, and lifecycle
descriptions of runtime behavior.

**A comment that contradicts the code is worse than no comment.** When a change reverses a decision
the surrounding prose argues for, rewrite that prose in the same commit — the next reader trusts
whichever of the two they happen to read first.

## Proposing simplifications

A simplification needs evidence, not taste. Strong cases: a public method, event, config knob,
helper or package with **no production consumer** (`packages/*/src`, `examples`, `scripts` — tests
and docs do not count); two representations mirroring one fact; hand-rolled code a maintained
dependency or Node builtin already covers; defensive machinery guarding an unused API.

Do not propose it when a production caller exists (that is a feature decision), when the removal
forces unrelated churn without shrinking any public surface, or when the defensive pattern protects
a load-bearing invariant. Correct but tiny belongs in a named `TODO(<smell>)`, not a proposal.

Seams that are intentional here — collapsing one is a product decision, not cleanup:

- the AgentHub boundary: PenguinHarness pins protocols and env fallback, AgentHub owns clients and
  routing;
- `packages/core/src/internal/` versus what the package barrel exports — the public SDK surface is
  a contract;
- the Trace on-disk format and its tolerant readers;
- the bilingual documentation pairs and the i18n catalogs;
- `desktop` running the *unchanged* server and Web App;
- `message-window.ts` mirroring `stream-model.ts` — the file's own job is to reproduce that
  accumulation for the pre-window prefix, and its tests pin the shared cases on both sides.

Prove consumers with `rg` over exact symbols, event names and wire strings, and read the call sites.
There is no `knip` here, and no Agent Note tree — a proposal lives in the PR description or an issue.

## What this repo is not

Imported wholesale from a sibling repo's workflow, these are wrong here:

- **Provider-client development.** No vendor doc syncing, no live API captures, no paired
  Python/TypeScript clients, no `AVAILABLE_MODELS`. That is agenthub's work; PenguinHarness only
  records presets in its catalog.
- **Agent Notes** (`.agents/notes/<lifecycle>/<class>/…`) and their supersession lifecycle. No such
  convention.
- **`knip`, `pnpm run doc-sync`, `pnpm run lint`.** None exist.
- **Coverage-scoped verification** (`--coverage.include`, per-file thresholds). No coverage gate is
  configured here, so narrowing means choosing test files, not proving coverage over a source scope.
- **Adding a skill to the repo root's `plugins/`** because it is "a skill". Those packages are the
  shipped, user-facing plugin library — a docs-sync test requires every plugin to appear in the
  bilingual skills pages, the README tables are test-checked, and everything there installs into
  users' agents. Repo development skills live in `.agents/skills/`.
