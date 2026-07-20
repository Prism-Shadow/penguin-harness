# Chat input: positional slash, skill chips above the input, wider skill menu

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
