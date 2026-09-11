# The default system prompt bounds retries, batches tool calls and verifies before it delivers

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `core`

[中文版](2026-09-11-system-prompt-guardrails.zh.md)

The default system prompt told an agent to retry a failing tool call and to stop on an error it
"cannot resolve", but never said what that looks like, so a stubborn error was met with an
open-ended run of variants. It also said nothing about batching tool calls, interactive commands,
guessed names or the project's own verification commands, so an agent read files one per turn, sat
on a `y/n` prompt until the poll timed out, imported packages the project does not have, and
reported a build it never ran. Ten small edits — a clause or a bullet each, borrowed from the
published Claude Code, Qoder and CodeBuddy prompts — close those gaps.

## Details

- `# Stop rules`: "cannot resolve" gained an observable trigger — the same error still there after
  three different fixes — and the report names what was tried; a request counts as ambiguous only
  after the files and environment have been checked.
- `# Tool use`: three bullets — never guess a path, flag, package, API or URL (a library is
  available only once the manifest or lockfile shows it); send independent tool calls together in
  one turn, since the engine runs a batch concurrently; run commands non-interactively and treat
  one waiting for input as stuck rather than slow.
- `# Success criteria`: verification means the project's own test, lint, typecheck and build
  commands, found in its README or manifest rather than assumed.
- `# Constraints`: match the surrounding code's conventions; a question gets an answer first, and
  files change only when asked.
- `# Suggested workflows`: a `PLAN.md` step is verified before the next starts and marked done only
  once it has been seen to work; a web app is scaffolded with the framework's CLI and fetched once
  before it is presented.
- A kernel change (generation `2026-09-11`, prompt tab): an existing Agent whose prompt tab is
  still the built-in default picks the rules up on a kernel update, while one the user has edited
  keeps what it says.
