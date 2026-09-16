# Preparing a release

Loaded on demand from `SKILL.md`. Everything here was reconstructed from a previous release's
commit rather than written down at the time — so when you deviate, record it here.

## The one rule that costs a version number

**A pushed tag is never moved.** Two numbers have been burned for two different reasons, and both
are worth knowing because they fail at opposite ends of the run:

- **0.2.10** got as far as publishing npm and Docker, then failed the signed macOS build. The tag
  existed, the packages were public, the Release page was not. Shipped again as 0.2.11.
- **0.2.12** failed in the *first* job, `Publish npm packages`, at its build step — so nothing
  reached npm, Docker or a Release page at all. Shipped again as 0.2.13.

A `release/**` branch proves the signed matrix before the tag exists, which is what 0.2.10 bought.
0.2.12 bought the rest: **CI has to walk the publishing path too**, because the release workflow
building differently from CI is a break that cannot appear until after the tag.

### What 0.2.12 actually hit

Two bugs, and the second is the one to remember:

1. The release job built a hand-written list of four packages with **bare `--filter`**. CI's setup
   action uses `<pkg>...` — pnpm for "the package *and its dependencies*" — so CI built
   `packages/hmr` transitively and was green, while the release job built `penguin-server` alone
   and its esbuild could not resolve the dependency. Three characters apart, and only the tag side
   was wrong. The job now runs `pnpm -r build`, so there is no list to fall out of.
2. `penguin-server` took the **private** `packages/hmr` as a runtime `dependency`. `pnpm publish`
   rewrites `workspace:*` to the dependency's current version, so the published manifest would have
   named a version npm has never seen and `npm install` would have failed with E404 — *after* a
   successful publish. tsup bundles it (`noExternal`), so it was never needed at runtime and
   belongs in `devDependencies`. `scripts/check-publishable.mjs` now fails CI on that shape; the
   `npm packaging` job also packs each publishable package with `npm pack --dry-run`.

The lesson under both: **a green CI that builds differently from the release proves nothing about
the release.** When the two diverge, the divergence is the defect.

## Order

1. Branch `release/<version>` off `main`, in a worktree.
2. Prepare everything below and push the branch. `desktop-build.yml` runs the full signed
   matrix on any push to `release/**` — that is the point of the branch.
3. Open the PR, `release: <version> — <one line>`. Merge when the matrix and `ci` are green.
4. Tag `v<version>` on the merge commit. `release.yml` reads
   `changelog/<version>/RELEASE.md` **out of the tag's own checkout** — a RELEASE.md added
   afterwards never reaches the Release page.

## What changes

| Path | Change |
| --- | --- |
| `changelog/unreleased/` | `git mv` to `changelog/<version>/`. Nothing else moves; released folders are frozen. |
| `changelog/<version>/RELEASE.md` | New. The Release body, verbatim. Shape below. |
| `CHANGELOG.md`, `CHANGELOG.zh.md` | One line at the top, linking `changelog/<version>/`. |
| `README.md`, `README.zh.md` | The Docker example pins the exact version (`hiyouga/penguinharness:<version>`). |
| `package.json`, `packages/*/package.json`, `plugins/*/package.json` | Version, in lockstep. |
| `packages/core/src/index.ts` | `export const VERSION`. |
| `packages/landing/content/blog/penguinharness-<v-with-dashes>.{en,zh}.md` | The post pair. |
| `packages/landing/test/blog.test.ts` | The new slug joins the expected list. |

**Anything whose version already differs is a decision, not a sweep.** Bump what sits on the
previous release's number without thinking about it. For the rest, decide and record the decision
in the PR body:

- `plugins/sandbox-*` track their own line deliberately — leave them.
- A package created mid-cycle at whatever number its author typed is the other case. `packages/hmr`
  arrived from #656 at 0.2.9 and was pulled into lockstep at 0.2.12: it is `private: true` and never
  published, so nothing ships wrong either way, and a package inside `packages/*` sitting three
  releases behind is a puzzle for the next reader.

What is not acceptable is a blanket bump that catches one of these silently.

The lockfile does not record workspace versions, so a pure version bump leaves `pnpm-lock.yaml`
alone. If it moves, something else moved with it — find out what.

Renaming the changelog folder breaks any path citation into `changelog/unreleased/`. Grep for it;
code comments cite that folder when they describe a compatibility shim's expiry, and a shim whose
deadline was "one release after this ships" can now name the release.

## RELEASE.md

One lead paragraph saying what this release is, then `## Install`, `## Highlights`,
`## Notable in this release`, `## Requirements`. The Install block is boilerplate — lift it from
the previous release and change the version.

Images here are **raw `raw.githubusercontent.com` URLs**, because a GitHub Release body has no
renderer. This is the exact opposite of the blog rule below. Getting them the wrong way round
produces a Release page of broken images or a blog of unrewritable links.

## The blog post

A pair under `packages/landing/content/blog/`, `title` / `date` / `category: news` / `excerpt`
frontmatter, one lead paragraph, then a `##` section per highlight with its screenshot, then
`## Also in this release` and `## Upgrading`. `## Upgrading` is the one section a reader acts on:
migrations that need a restart, plugins that must be installed on existing Agents, renamed flags,
routes that moved. Say what breaks and what to do, one bullet each.

Images are written `/blog-assets/<name>` and resolved by `blogAssetUrl`; never paste the raw
host. Screenshots are named `penguinharness-<v-with-dashes>-<feature>-<lang>.png` and **shot once
per UI language** — the post pair references `-en.png` and `-zh.png` separately.

The assets live in the sibling `Prism-Shadow/penguin-harness-community` repo under
`blog-assets/`, not here.

## Screenshots

Captured, not mocked: drive the app through the Playwright harness in `packages/web/e2e/` with
its mock LLM against a scratch `PENGUIN_HOME` — never `~/.penguin`, which is real data. Shoot at
`deviceScaleFactor: 2` and crop to the feature rather than the window. Check every frame for what
must not ship: absolute paths carrying a home directory, API keys, and mock-model filler text.

## Polishing the prose

Release prose goes through a DeepSeek model on the TokenDance gateway before it ships —
`https://tokendance.space/gateway/v1/chat/completions`, OpenAI Chat Completions protocol, model
`deepseek-v3.2`. The key is the user's TokenDance key; take it from `TOKENDANCE_API_KEY` or a
file named by `TOKENDANCE_KEY_FILE`, never from an argument, and never commit it. Not every model
in the catalog is enabled on a given key — a 403 `model_access_denied` means that key needs the
model granted on the site, not that the key is bad.

`scripts/polish-release-prose.mjs` beside this file carries the instruction and does the call:

```sh
TOKENDANCE_KEY_FILE=~/.config/tokendance-key \
  node .agents/skills/penguin-harness-dev/scripts/polish-release-prose.mjs changelog/<version>/RELEASE.md
```

It prints to stdout; `--write` rewrites the file, `--model <id>` overrides the default.

The register to ask for is **VS Code's release notes**: a developer writing for developers, plain
and unhyped, each section leading with what changed in one sentence, concrete nouns and numbers
carrying the weight. The instruction that produces it:

> You are editing the release notes of PenguinHarness, an open-source TypeScript harness for AI
> agents. The audience is developers deciding whether to upgrade.
>
> Voice and shape — follow VS Code's release notes:
> - A developer writing for developers. Plain, direct, unhyped.
> - Lead each section with what changed, in one sentence. Then the detail that makes it usable.
> - Concrete nouns, numbers, defaults, limits, flags and file names carry the weight. Adjectives do not.
> - Short paragraphs. One idea each. Prefer a sentence over a clause pile.
> - No marketing register: no "powerful", "seamless", "revolutionary", "we are excited to".
> - No second-person cheerleading and no rhetorical questions.
>
> Hard constraints:
> - Preserve every technical fact exactly: names, numbers, versions, paths, flags, defaults,
>   limits, error codes, command lines. Never invent one, never round one, never drop one.
> - Preserve the Markdown structure as given: heading levels and order, image references and their
>   alt text, code fences and their contents, link targets. Edit prose only.
> - Keep the input's language. English in, English out. Chinese in, Chinese out. Do not translate.
> - If a sentence is already good, leave it alone. Polishing is not rewriting.
>
> Return only the polished Markdown. No preamble, no commentary, no fences around the whole document.

**Read the result against the source before taking it**, and check it mechanically first. Over one
release the model, told plainly not to, still: added an `# H1` title the document did not have,
turned all thirteen bullets of a section into paragraphs, unspaced every em dash, and dropped
fact-bearing clauses that carried no number — `produces only the CEO` became `produces a CEO`, and
`one standing desk session per employee` vanished entirely.

So diff the facts before you read for voice:

```sh
comm -23 <(grep -oP '`[^`]+`' before.md | sort -u) <(grep -oP '`[^`]+`' after.md | sort -u)
comm -23 <(grep -oP '\]\([^)]+\)' before.md | sort -u) <(grep -oP '\]\([^)]+\)' after.md | sort -u)
```

**Count each structure class on its own line, never summed.** A combined
`grep -c '^## \|^- '` hid thirteen destroyed bullets behind an unchanged total. Compare `^## `,
`^- `, '^```' and `^!\[` separately.

Those checks catch identifiers, links and shape. They do not catch a dropped clause, which is why
the last pass is a human one.

## Two traps

**`format:check` cannot see any of this.** `.prettierignore` excludes `*.md` repo-wide, so prettier
is silent on every changelog entry, every RELEASE.md and every blog post. Its passing says nothing
about the work you just did; check the Markdown by reading it.

**Release prep is the last moment to fix a changelog entry's metadata**, because the folder freezes
on release. Before renaming `unreleased/`, sweep the whole batch: every entry has a `PR` field,
every `Type` is one of the four the README allows, no bare `#N` survives in prose (it does not
render as a link), and an entry amended by later PRs cites all of them. Over one release that swept
up seven missing `PR` fields, four out-of-set `Type` values and two bare `#N`.

One asymmetry to know while doing it: the metadata block is English on both sides of a pair, **except
the `Breaking` reason, which is prose and is translated**. The two blocks are otherwise byte-identical.
