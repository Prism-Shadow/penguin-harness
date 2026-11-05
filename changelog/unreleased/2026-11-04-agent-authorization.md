# Risky actions wait for a person's go-ahead: an `# Authorization` prompt section and `ask` rules in the command policy

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `ui`, `docs`

[中文版](2026-11-04-agent-authorization.zh.md)

An agent no longer merges a pull request, publishes a package or force-pushes on its own. Two layers carry this: a section of the default system prompt that every Agent reads, and command-policy rules that stop the commonest of those commands even under `allow-all`.

## The `# Authorization` prompt section

The default system prompt gains `# Authorization` between `# Constraints` and `# Output`. It asks the model for four things:

- Get the user's explicit go-ahead in this conversation before an action that is hard to undo or reaches beyond the machine, unless the user authorized it durably (in `AGENTS.md`, a memory, or the task itself). The section names the class: merging, closing or approving pull requests; pushing to a default or protected branch, force-pushing, deleting branches or tags; deleting or overwriting outside the Workspace and the scratchpad; publishing, releasing, deploying; messaging external services; spending money; changing permissions or credentials.
- Treat consent as covering the step it was given for. Consent from earlier, from another conversation, for a similar step, or recorded only in a compaction summary does not count.
- Look before destroying or overwriting, and say what will be lost.
- Report every action with an effect outside the Workspace, failed and partial ones included.

The kernel moves to `2026-11-04` (the prompt tab). An existing Agent adopts the section through the kernel update on the Agents page. The update re-reads every running conversation's prompt prefix once, at its next rotation.

## `ask` rules in the command policy

A command-policy rule now has an `action`: `deny` (the default, as before) refuses a matching call, and `ask` puts it to a person under every approval mode but `deny-all`. The Web App shows such a call as an ordinary approval card, with one muted line naming the rule that asked. A `deny` hit outranks an `ask` hit wherever the two sit in the list. An organization's unattended Sessions deny an `ask` hit at once, a pre-tool-use hook's `allow` does not get past it, and a subagent's hit reaches the same person.

New Projects are seeded with five factory `ask` rules after the nine `deny` rules:

| Rule | Matches |
| --- | --- |
| `gh-pr-merge-close` | `gh pr merge`, `gh pr close` |
| `gh-release` | `gh release create`, `delete`, `edit` |
| `git-push-force` | `git push` with `-f`, `--force` or `--force-with-lease` |
| `git-push-default-branch` | `git push` to `main` or `master` |
| `package-publish` | `npm publish`, `pnpm publish`, `yarn publish` |

A Project that already stores its rule list keeps it as it is. It adopts the five rules with **Restore defaults** on the security page of the Project settings, which replaces the whole list once saved. A Project that never saved its list reads as the factory set and has them already.

The rule editor gains a Deny / Ask choice, and an `ask` rule's row carries an "Asks first" pill. `.project_config.toml` stores `action = "ask"` on such a rule.

## SDK

`RunOptions.askHuman` (type `AskHumanFn`, an `ApproveFn` that is also told the rule) is the host's route to a person for an `ask` hit. Without it, `approve` decides. `Session.setSubagentApprovalFallback(approve, askHuman?)` now wraps the fallback sink with the command policy. The server's `approval_request` event carries `reason: { kind: "policy", rule }` for such a call, and the `approval_decision` record is unchanged.
