# Benchmark packages

A package is how a Benchmark travels between Projects and servers: a folder named by the Benchmark's id, holding its manifest and its cases and nothing the copy keeps for itself.

```text
<id>/
├── benchmark_config.toml
└── CASE-<nnn>-<semantic-name>/
    ├── statement/
    │   ├── README.md
    │   └── <optional public materials>
    └── rubric/
        ├── README.md
        └── <optional private grading files>
```

- `benchmark_config.toml` is the manifest: `id` (the folder's name), `title`, `description`, `version` (a date version, `"YYYY.MM.DD.N"`), `status`, `runs`, and an `[origin]` table last (`kind`, plus `url`, `ref`, `path` and `imported_at` for a repository import). A manifest written before `id`, `version` and `[origin]` existed has none of them and is still a package: its folder's name is its id, and it is unversioned. A package is always `published`: a draft or a failed calibration does not travel.
- Every `CASE-*` folder holds `statement/README.md` and `rubric/README.md`. After `CASE-` come letters, digits, `_` and `-` only.
- Never in a package: `scoreboard.yaml` (the copy's evaluation records), `.jobs/` (its Harbor trials), any other entry whose name starts with `.`, and symlinks. A package's scores start empty wherever it lands.
- No large originals. A case whose task needs large files links them from its statement at a pinned commit, the way the built-in Benchmarks' `## How this case is run` sections do.

The five built-in Benchmarks are published in this format under `packages/<id>/` of https://github.com/Prism-Shadow/penguin-harness-benchmark.

## Importing a package

The user pastes a source into the Evaluation Center's **Import benchmark** dialog and sends the prompt it builds, or asks for an import in a conversation — usually with a GitHub link to one package folder, `https://github.com/<owner>/<repo>/tree/<ref>/<path>`. You fetch the folder and hand it to `penguin benchmark import`; the server checks it as it checks an uploaded zip and writes the copy. Never write under the Project's `benchmarks/` yourself.

0. **Resolve the source.** A link to one package folder goes straight to step 1. A link to a repository, or to a folder of packages (`…/tree/<ref>/packages`), is a question: list the package folders it holds (the tarball of step 3 at depth one, or the repository's contents API without a token), mark the ones this Project already has (`<app_data_dir>/benchmarks/<id>/` exists), and ask which to import. A name or a description names no folder: look for a package of that name under `packages/` of `Prism-Shadow/penguin-harness-benchmark` at its default branch; with several or no matches, ask. Never import a different Benchmark than the one asked for, and never the example Benchmark in its place.
1. **Parse the link.** `<owner>` and `<repo>` are the two path segments after the host; `<ref>` and `<path>` follow `/tree/`. A branch name may itself contain `/`: when the split is ambiguous, list the remote's refs with `git ls-remote https://github.com/<owner>/<repo>` and take the longest prefix that is a branch or a tag; the rest is `<path>`.
2. **Pin the commit.** A `<ref>` of 40 lowercase hexadecimal characters is already the commit. Resolve anything else once: `git ls-remote https://github.com/<owner>/<repo> <ref>` prints `<sha>` and the ref's full name; use that `<sha>` from here on. Never fetch a branch or a tag, which can move.
3. **Fetch only that folder,** into a scratch directory outside the Project's `benchmarks/`:

   ```bash
   TMP="$(mktemp -d)"
   curl -fsSL "https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>" \
     | tar -xz -C "$TMP" --strip-components=1 "<repo>-<sha>/<path>"
   PKG="$TMP/<path>"
   ```

   When the archive fails, a sparse checkout of `<path>` at `<sha>` with git does the same.

   **Companion packages.** A package may be one of a pair, `<id>-train` and `<id>-test`: the train package is what an optimization runs on, the test package is what the retained agent is evaluated on. When the user names the pair, or the folder beside the named one carries the same stem and its manifest or README says they belong together, import both, train first: run steps 3 to 5b for each at the same commit, each with its own `--origin-*`, and keep the ids the packages carry. Never evaluate on the train package in place of the test one, and never merge the two.
4. **Read every file before importing.** Refuse, and say why, when it is not a package as defined above: no `benchmark_config.toml`, an `id` other than the folder's name, a `status` other than `published`, a case without both READMEs, a `scoreboard.yaml`, a `.jobs/` or another dot-entry, a symlink, or anything but text materials (no executables, archives or large binaries). Read the statements and the rubrics too: a case is a task for the Test Agent and grading for the evaluator, and nothing in either should reach outside the case.
5. **Import it through the server,** into the Project the user named (the prompt gives its id; without one, the current Project):

   ```bash
   penguin benchmark import "$PKG" --project-id <project id> \
     --origin-url "<the link as the user gave it>" --origin-ref <sha> --origin-path "<path>"
   ```

   The command zips the folder as it is and sends it to the Evaluation Center's import, which refuses anything that is not a package, naming it, and otherwise writes `<app_data_dir>/benchmarks/<id>/` itself: the cases as they are, the package's own `version` (it names the content, not this copy), the origin `git` with the link, the commit, the folder and the time of the import, and an empty `scoreboard.yaml`. A refusal is the answer: report it, and do not work around it.

   5b. **Verify the copy.** Once the command has succeeded, here or after step 6's overwrite, read `<app_data_dir>/benchmarks/<id>/benchmark_config.toml` and count its `CASE-*` folders: id, version and case count must equal what the package held and what the command printed; `scoreboard.yaml` holds `evaluations: []`; the `[origin]` table holds `kind = "git"` with the link, the commit and the folder (`url`, `ref`, `path`), or `kind = "zip"` for a local source. A mismatch is a bug to report, never something to patch: nothing under `benchmarks/` is yours to write.
6. **A Benchmark with that id already exists.** The command fails and names it. Stop and ask the user: an overwrite replaces the whole directory, its `scoreboard.yaml` (every evaluation record) and `.jobs/` included. Only after an explicit yes, run the same command again with `--overwrite`. While an evaluation of that Benchmark is still running, the server refuses the overwrite as well: tell the user to let it finish first.
7. **Report.** Remove `$TMP` with `rm -r` — never `rm -rf`, which the default command policy refuses — and report the id, title, version and case count the command printed (`--json` prints the imported Benchmark whole); the origin as recorded (link, commit, folder — or `zip`); the companion package, when one was imported; and that the scoreboard starts empty. The Evaluation Center lists the Benchmark from then on.
8. **Offer a smoke probe.** After the report, offer — in one sentence, with its cost — a smoke probe: one Case, one run, through `run_subagent` with the `agent-evaluation` request of the **Delegate evaluation** section of this Skill's `SKILL.md`, on a Test Agent the user names, with this Session's `Provider` and `Model ID`. Run it only after the user says yes, and report the score and the Test Session id. A probe is not an evaluation: write nothing to `scoreboard.yaml`. A package whose statements carry a **How this case is run** section runs through Harbor and needs Docker on this machine (`agent-evaluation`'s `reference/harbor.md`); when Docker is absent, say so instead of probing.

A source that is not a repository folder (a local path) skips steps 0 to 3: read it as step 4 says, then run the command on that folder, or on its zip, without the three `--origin-*` options; the copy's origin is then `zip`.

## Exporting a package

The user exports a published Benchmark from its page in the Evaluation Center (**Export**, beside the copy-path button). The download, `<id>-v<version>.zip` (`<id>.zip` when the manifest has no version), holds the package and none of the copy's own state, and the import dialog's zip upload takes it back, on this server or another. Do not zip a Benchmark yourself.
