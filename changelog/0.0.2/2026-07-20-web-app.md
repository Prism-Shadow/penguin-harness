# Web App

Chat input, session titles, and the skill library in the Web App.

## Chat input: positional slash, skill chips above the input, wider skill menu

The `/` command menu now opens from any caret position (like `@` mentions) and running a
command removes just the token; selected skills display as chips above the input next to
the agent chip; chip remove buttons recolor on hover instead of washing a background; the
skill dropdown widens for readable descriptions while staying inside phone screens.

## Details

- Positional slash (`slash-token.ts`, pure + unit-tested): a `/` at the start of the text
  or after whitespace opens the command menu from wherever the caret is (paths/URLs never
  trigger it), mirroring the existing positional `@` mention matching; running a command
  removes only the `start..end` token and keeps the rest of the text. Send-time `@`
  semantics are unchanged — only a leading `@` hands off.
- Selected skills render as chips above the input in the same row as the `@` handoff chip
  (skill icon + monospace name + remove x), appearing as you pick them from the dropdown;
  the toolbar count badge stays in sync.
- Chip remove buttons (agent and skill) lose the hover background — the x recolors instead.
- The skill dropdown widens (26rem, clamped to the viewport) so descriptions stay readable
  on desktop without overflowing phones.
- The models-page group speed button collapses to icon-only below the sm breakpoint (three
  labeled actions don't fit a 390px header — caught by the layout e2e).

## Start title generation after 1000 chars of body text

Session titles start generating as soon as ~1000 characters of main-session body text have
streamed, instead of waiting for the whole Task to finish — long answers no longer overrun
the title material — and the title prompt now suppresses chain-of-thought.

## Details

- Server: the output relay fires the title generator mid-run once EARLY_TITLE_BODY_CHARS
  (1000) of main-session complete body text have streamed (sub-session text doesn't count);
  the generator self-guards (NULL title, single flight), and the Task-completion trigger
  stays as the short-answer fallback. Covered by a gated mid-run test proving the early
  fire happens while the run is still in flight.
- Core: the captured assistant-side title material is capped at 1000 chars (the user side
  keeps 2000) — a title only needs the opening of the answer.
- The title prompt adds an explicit "answer immediately — do not think aloud or produce
  chain-of-thought" rule and ends with an empty `<think></think>` block, which many
  reasoning models treat as an already-closed thinking phase (same trick as the model
  probe), keeping the one-off request's budget on the title itself.

## Skill library: update reminder, borderless groups, accent icons

The skill library reminds you when an Agent's installed copy of a skill is older than the
library's version — an accent rotate button on the card updates every outdated Agent in one
click, and the manage-installs dialog marks outdated rows with an Update button. Group
sections lose their border, and card icons sit on a theme-accent background.

## Details

- The installed-skills snapshot now tracks each installed copy's `version` (the read API
  already returns it — the installed SKILL.md frontmatter is the source). A pure
  `outdatedAgentIds` helper (unit-tested) flags Agents whose copy is strictly older than
  the library's; not-installed Agents and locally *newer* copies never trigger it.
- Card footer: when any Agent is outdated, an accent rotate button appears
  ("有新版本：更新 N 个 Agent 的安装" / "Update available"); clicking reinstalls the current
  library copy on every outdated Agent (install-again-is-update semantics) with one batch
  success toast; partial failures keep the succeeded Agents and toast the first error.
- Manage-installs dialog: outdated rows show an accent "更新"/"Update" button next to
  "已安装"/"Installed", updating just that Agent.
- Styling: group sections are borderless (header background alone carries the grouping);
  card icons use the theme accent (`--accent-bg`/`--accent-fg`, following the theme-color
  setting) instead of the gray bordered tile.
