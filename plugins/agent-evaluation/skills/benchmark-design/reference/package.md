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
- No large originals. A case whose task needs large files links them from its statement at a branch, tag or commit, the way the built-in Benchmarks' `## How this case is run` sections do.

The built-in Benchmarks are published in this format under `packages/<id>/` of https://github.com/Prism-Shadow/penguin-harness-benchmark.

## Importing a package

A Benchmark's files are the source of truth. Import it by copying its manifest and case folders into the Project's `<app_data_dir>/benchmarks/<id>/`; the Evaluation Center reads that directory directly.

1. **Find the package.** A repository folder link names one package. For a repository root, a list of packages or an ambiguous description, list the choices and ask which to import. A local folder can be read directly; extract a local zip to a temporary directory first. Use the target Project's `app_data_dir` from its context, not the session workspace or an assumed default data root.
2. **Pin repository sources.** Resolve the link's branch or tag to a 40-character commit with `git ls-remote`. A branch may contain `/`: use the longest matching ref prefix to separate the ref from the folder path. Fetch the package at that commit into a temporary directory:

   ```bash
   TMP="$(mktemp -d)"
   curl -fsSL "https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>" \
     | tar -xz -C "$TMP" --strip-components=1 "<repo>-<sha>/<path>"
   PKG="$TMP/<path>"
   ```

   A sparse checkout at the same commit also works. When a named package has a documented train/test companion, import the pair at the same commit, each under its own id. Keep their cases separate.
3. **Read the package.** Check the manifest and every case against the format above. The id must match the folder and contain only letters, digits, `_` and `-`. Refuse missing READMEs, unpublished packages, symlinks, executables and unrelated content. Keep large upstream materials at the links in the statements.
4. **Check the destination.** If `<app_data_dir>/benchmarks/<id>/` already exists, stop and ask before replacing it: replacement deletes its evaluation records and run results. Do not replace a Benchmark while it is being evaluated; unfinished trials under `.jobs/` (no `result.json`) or packed `*.agent-state.tar.gz` files are signs of an active evaluation. Wait for it to finish. An approved replacement removes the old directory whole before copying, so cases from different versions cannot mix.
5. **Copy the files.** For a new destination, create its directory, copy the manifest and case folders, and write an empty scoreboard. Stop if any command fails, especially if the destination already exists:

   ```bash
   set -e
   DEST="<app_data_dir>/benchmarks/<id>"
   mkdir -p "<app_data_dir>/benchmarks"
   mkdir "$DEST"
   cp "$PKG/benchmark_config.toml" "$DEST/"
   cp -R "$PKG"/CASE-* "$DEST/"
   printf 'evaluations: []\n' > "$DEST/scoreboard.yaml"
   ```

   Preserve the package's title, description, version and cases. Set the manifest's `id` if it was absent. Replace its `[origin]` table (do not append a second table): for a repository source, use `kind = "git"`, `url` (the supplied link), `ref` (the pinned commit), `path` (the repository folder) and `imported_at` (the import time in ISO 8601). For a local source, use `kind = "zip"` and `imported_at`. Never bring over `scoreboard.yaml` or `.jobs/` from the source.
6. **Verify and report.** Read the copied manifest, count the case folders and check their files against the source. Confirm the scoreboard contains `evaluations: []`. Report the id, title, version, case count, destination and recorded source, including any companion package. Remove the temporary directory you created. Importing does not start an evaluation; run one only if the user requests it.

## Exporting a package

The user exports a published Benchmark from its page in the Evaluation Center (**Export**, beside the copy-path button). The download, `<id>-v<version>.zip` (`<id>.zip` when the manifest has no version), holds the package and none of the copy's own state, and the import dialog's zip upload takes it back, on this server or another. Do not zip a Benchmark yourself.
