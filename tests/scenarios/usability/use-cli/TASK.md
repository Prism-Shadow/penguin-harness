---
title: Use the CLI as a new user, along a fixed path and then freely
starts_from: install/from-ref
inputs:
  handover: <RUN>/install/from-ref/handover.md
  model_credential: a model provider and key the run may use, or "none"
cost: 30
platforms: [linux, macos, windows]
---

## Goal

Use the freshly installed `penguin` command the way a new user would, with nothing but its own
help text to go on. First walk a fixed path, so that runs on different refs and platforms can be
compared step by step; then explore freely and look for what a new user would trip over in the
terminal.

## Steps

Read `handover.md` first. Run every command with the `HOME` it names and the installed `penguin`,
never a CLI from a checkout. Keep `oplog.md` from the first command: one line per command, with the
time, the command line, its exit code, and the first lines of its output. Save each command's full
output under `evidence/` and screenshot the terminal where the layout matters (tables, colours,
wrapping).

The fixed path:

1. **Help and version.** `penguin --help`, `penguin --version`, `penguin version`. Every top-level
   command listed, present or absent; whether the two version outputs agree with the ref.
2. **Every command's help.** `penguin <command> --help` for each top-level command. Record any help
   text that is empty, untranslated, or names an option the command then refuses.
3. **Reach the server.** Sign in to the server from `handover.md` with `penguin auth`, as its help
   describes. Record each prompt and message.
4. **Projects and Agents.** `penguin project` and `penguin agent` listings; the default Project and
   Agent a new install has.
5. **Configuration.** `penguin config` as its help describes: read the current configuration, set
   the model credential from the plan (skip with "none" and record what later steps say about the
   missing credential).
6. **A task.** `penguin run` with a one-line prompt; then `penguin ls`, `penguin logs` and
   `penguin cost` for the Session it made. Record whether the Session also shows in the Web App
   under the same Project.
7. **Mistakes.** An unknown command, a missing required argument, a wrong option value. Each
   error must say what was wrong and what to do; quote it.

Then explore freely for the rest of the budget: `penguin chat`, `penguin schedule`,
`penguin browser`, output in a narrow terminal, the interface language. Every finding gets its own
evidence file.

For every step, the counter-example is: a stack trace instead of a message, a command that hangs
with no output, an exit code of 0 on failure, or help text that does not match what the command
does.

## Record

In `<RUN>/usability/use-cli/`: `report.html` (the fixed path first, step by step, then the free
exploration), `shots/`, `evidence/`, `oplog.md`, `issues.md`.

## Done when

Every step of the fixed path has its output recorded and a verdict, the free exploration has used
its share of the budget, and every finding is in `issues.md`.

## Never

- Run `penguin update`, `penguin server reset-admin-password`, or any command that deletes data,
  other than through its `--help`.
- Use real credentials of anyone; use only the credential the plan gives.
- Point the CLI at any server other than the one in `handover.md`.
- Report a step as fine without its output in `evidence/`.
