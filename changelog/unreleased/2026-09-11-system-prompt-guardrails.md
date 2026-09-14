# Guardrails and interaction rules in the default system prompt

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `core`
- **PR:** [#697](https://github.com/Prism-Shadow/penguin-harness/pull/697)

[中文版](2026-09-11-system-prompt-guardrails.zh.md)

The default system prompt told an agent to retry a failing tool call and to stop on an error it
"cannot resolve", but never said what that looks like, so a stubborn error was met with an
open-ended run of variants. It said nothing about batching tool calls, interactive commands,
guessed names or the project's own verification commands, so an agent read files one per turn, sat
on a `y/n` prompt until the poll timed out, imported packages the project does not have, and
reported a build it never ran. And it said little about how to talk to the user, so replies opened
with "Sure!", narrated tool names, pasted commands for the user to run, put links in code formatting
where they cannot be clicked, and ended without saying where the work was. Fourteen small edits — a clause or a bullet each, several replacing an existing
sentence, borrowed from the published Claude Code, Qoder and CodeBuddy prompts — close those gaps.

## Details

- `# Stop rules`: "cannot resolve" gained an observable trigger — the same error still there after
  three different fixes — and the report names what was tried; a request counts as ambiguous only
  after the files and environment have been checked, and the clarification is one specific question
  with the options seen.
- `# Tool use`: the "prefer your tools" bullet became "work from evidence, not memory", with the
  rule to run a command or edit a file yourself rather than paste it for the user; three bullets
  joined it — never guess a path, flag, package, API or URL (a library is available only once the
  manifest or lockfile shows it); send independent tool calls together in one turn, since the engine
  runs a batch concurrently; run commands non-interactively and treat one waiting for input as stuck
  rather than slow.
- `# Output`, a new section in the slot PRN-010 gives it between `# Constraints` and `# Stop rules`:
  lead with the outcome, skipping filler openers, narration of the next tool call and closing
  recaps; plain words rather than tool names, and no restating output the user can see; each file
  created or updated is named by its workspace-relative path in backticks (moved here from
  `# File system`); links are written as plain URLs or Markdown links, never inside backticks or a
  code block; the final answer stands on its own — what was done, which files, how to run or verify
  it, what is left undone; a refusal is one sentence plus the nearest alternative. `# Personality`
  keeps only its tone sentence.
- `# Success criteria`: verification means the project's own test, lint, typecheck and build
  commands, found in its README or manifest rather than assumed.
- `# Suggested workflows`: a `PLAN.md` step is verified before the next starts and marked done only
  once it has been seen to work; a web app is scaffolded with the framework's CLI and fetched once
  before it is presented.
- A kernel change (generation `2026-09-11`, prompt tab): an existing Agent whose prompt tab is
  still the built-in default picks the rules up on a kernel update, while one the user has edited
  keeps what it says.
