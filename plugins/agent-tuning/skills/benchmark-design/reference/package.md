# Benchmark packages

A package is how a Benchmark travels between Projects and servers: a folder named by the Benchmark's id, holding its manifest and its cases and nothing the copy keeps for itself.

```text
<id>/
├── benchmark.json
└── CASE-<nnn>-<semantic-name>/
    ├── statement/
    │   ├── README.md
    │   └── <optional public materials>
    └── rubric/
        ├── README.md
        └── <optional private grading files>
```

- `benchmark.json` holds `id` (the folder's name), `title`, `description`, `version` (a date version, `YYYY.MM.DD.N`), `status`, `runs` and `origin`. A package is always `published`: a draft or a failed calibration does not travel.
- Every `CASE-*` folder holds `statement/README.md` and `rubric/README.md`. After `CASE-` come letters, digits, `_` and `-` only.
- Never in a package: `scoreboard.yaml` (the copy's evaluation records), `.jobs/` (its Harbor trials), any other entry whose name starts with `.`, and symlinks. A package's scores start empty wherever it lands.
- No large originals. A case whose task needs large files links them from its statement at a pinned commit, the way the built-in Benchmarks' `## How this case is run` sections do.

The five built-in Benchmarks are published in this format under `packages/<id>/` of https://github.com/Prism-Shadow/penguin-harness-benchmark.

## Importing a package

The user pastes a source into the Evaluation Center's **Import benchmark** dialog and sends the prompt it builds — usually a GitHub link to one package folder, `https://github.com/<owner>/<repo>/tree/<ref>/<path>`. Nothing is written under the Project's `benchmarks/` before step 6.

1. **Parse the link.** `<owner>` and `<repo>` are the two path segments after the host; `<ref>` and `<path>` follow `/tree/`. A branch name may itself contain `/`: when the split is ambiguous, list the remote's refs with `git ls-remote https://github.com/<owner>/<repo>` and take the longest prefix that is a branch or a tag; the rest is `<path>`. A link to a whole repository rather than one folder: list the packages it holds and ask the user which one.
2. **Pin the commit.** A `<ref>` of 40 lowercase hexadecimal characters is already the commit. Resolve anything else once: `git ls-remote https://github.com/<owner>/<repo> <ref>` prints `<sha>` and the ref's full name; use that `<sha>` from here on. Never fetch a branch or a tag, which can move.
3. **Fetch only that folder,** into a scratch directory outside the Project's `benchmarks/`:

   ```bash
   TMP="$(mktemp -d)"
   curl -fsSL "https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>" \
     | tar -xz -C "$TMP" --strip-components=1 "<repo>-<sha>/<path>"
   PKG="$TMP/<path>"
   ```

   When the archive fails, a sparse checkout of `<path>` at `<sha>` with git does the same.
4. **Read every file before writing anything.** Refuse, and say why, when it is not a package as defined above: no `benchmark.json`, an `id` other than the folder's name, a `status` other than `published`, a case without both READMEs, a `scoreboard.yaml`, a `.jobs/` or another dot-entry, a symlink, or anything but text materials (no executables, archives or large binaries). Read the statements and the rubrics too: a case is a task for the Test Agent and grading for the evaluator, and nothing in either should reach outside the case.
5. **Check the place.** The copy goes to `<app_data_dir>/benchmarks/<id>/`. When that directory exists, stop and ask the user: an overwrite replaces the whole directory, its `scoreboard.yaml` (every evaluation record) and `.jobs/` included. Only after an explicit yes, remove it with `rm -r` — never `rm -rf`, which the default command policy refuses.
6. **Write it.** Copy `$PKG`'s files to `<app_data_dir>/benchmarks/<id>/`. In `benchmark.json`, rewrite `origin` and keep every other field as the package has it — its `version` names the content, not this copy:

   ```json
   "origin": {
     "kind": "git",
     "url": "<the link as the user gave it>",
     "ref": "<sha>",
     "path": "<path>",
     "imported_at": "<now, ISO 8601: date -u +%Y-%m-%dT%H:%M:%SZ>"
   }
   ```

   A source that is not a repository folder (a local path) is copied the same way, with `"origin": {"kind": "agent"}`. Then write `scoreboard.yaml` holding `evaluations: []`.
7. **Verify and report.** Parse `benchmark.json` again (valid JSON, `id` equal to the folder's name, `ref` 40 hexadecimal characters), check that every case still has both READMEs, remove `$TMP` with `rm -r`, and report the id, title, version and case count. The Evaluation Center lists the Benchmark from then on.

## Exporting a package

The user exports a published Benchmark from its page in the Evaluation Center (**Export**, beside the copy-path button). The download, `<id>-v<version>.zip`, holds the package and none of the copy's own state, and the import dialog's zip upload takes it back, on this server or another. Do not zip a Benchmark yourself.
