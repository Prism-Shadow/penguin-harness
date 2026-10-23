# Profile: landing copy

Loaded for `--profile landing`: strings for the landing page's dictionaries
(`packages/landing/src/lib/strings-en.ts` and the zh dictionary in `strings.ts`, kept to one shape
by the `Strings` type). The brief lists the keys, where each string is shown and the strings around
it. The `prompt` block is sent to the model as `{{PROFILE}}` after the style guide. The model's
lines are copied into the dictionaries verbatim; nobody rewords them on the way.

<!-- prompt -->
Landing copy convinces by being specific. Match the page's existing voice: short, concrete, calm.
- Every string says one thing a developer can check: a capability, a number from FACTS, a platform, a licence.
- English running text writes "agent" in lowercase; product terms keep their casing (Workspace, Token, Task, Skill, Trace, Session, Project).
- A heading is a short noun phrase or a plain statement; a subtitle is one sentence; a button is a verb and its object.
- No superlative without a FACTS number behind it, no exclamation marks, no emoji, no "unlock", "supercharge", "seamless" or "next-level".
- Chinese strings are written as Chinese landing copy in their own right, in the same length class as the English ones.
<!-- /prompt -->

## Check settings

- lead: no
