# Backward compatibility

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `desktop`
- **PR:** [#480](https://github.com/Prism-Shadow/penguin-harness/pull/480)
- **Breaking:** yes — a "Not Now" answered to the pre-0.2.7 one-time `penguin` offer is not carried forward; the command installs itself on the next launch

[中文版](2026-08-27-backward-compatibility.zh.md)

One piece of existing state is touched by this batch: the marker the desktop app wrote when
it offered to install the `penguin` command, now that
[the app installs it automatically](2026-08-27-desktop-installs-cli.md).

## The `cli-install-offered` marker

Desktop releases 0.2.2 through 0.2.6 wrote an empty `cli-install-offered` file under
`userData` and skipped the offer whenever it existed. It was written **before** the dialog
was shown, so it records that the question was asked and not what was answered — an install,
a "Not Now" and a dialog that never got an answer all leave the same file. It therefore
cannot be read as a decline, and reading it as one would deny the command to every existing
install.

Chosen: **the marker is not migrated.** It is ignored, and removed the first time the new
state file is written. What replaces it, `cli-command.json` in the same directory, records
the outcome of the last attempt and — separately — a decision, which is set only by
dismissing the macOS administrator prompt. Only that decision stops the automatic attempt.

The removal is one `rmSync` per state write. It stays until no 0.2.2–0.2.6 install can
still upgrade into a current build; whoever prepares 0.3.0 owns deleting it, and the code
site carries the same note.

## Compatibility

Nothing has to be migrated and no action is required. Two consequences to know about:

A user who answered "Not Now" to the old offer gets the command installed on the next
launch, because that answer was never recorded. Removing it is one command — delete
`/usr/local/bin/penguin` on macOS or `~/.local/bin/penguin` on the Linux AppImage, or drop
the app's `bin` entry from the user `Path` on Windows — but the app will install it again
on the following launch, since only a dismissed macOS administrator prompt is remembered as
a decision.

A `penguin` that came from anywhere else is never touched. An `install.sh` install, a global
npm package or a hand-written script keeps its place on `PATH` and the app installs nothing;
the skipped reason is recorded in `cli-command.json`.
