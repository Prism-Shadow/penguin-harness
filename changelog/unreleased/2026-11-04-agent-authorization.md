# Risky actions wait for a person's go-ahead: a go-ahead rule in the prompt's `# Tool use` and `ask` rules in the command policy

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `ui`, `docs`
- **PR:** [#1490](https://github.com/Prism-Shadow/penguin-harness/pull/1490)

[中文版](2026-11-04-agent-authorization.zh.md)

An agent no longer merges a pull request, publishes a package or force-pushes on its own. Two layers carry this: a rule in the default system prompt that every Agent reads, and command-policy rules that stop the commonest of those commands even under `allow-all`.

## The go-ahead rule in `# Tool use`

The default system prompt's `# Tool use` section gains one rule:

- An action that is hard to undo or reaches beyond the machine (merging or closing a pull request, pushing to the default branch or force-pushing, releasing, publishing a package, deleting what the user owns) needs the user's go-ahead in this conversation, unless the user authorized it durably in `AGENTS.md`, a memory, or the task itself.
- A yes covers only the step it was given for. One from another conversation or a compaction summary does not carry over.
- The model looks before it destroys anything.

The kernel moves to `2026-11-09` (the prompt tab). An existing Agent adopts the rule through the kernel update on the Agents page. The update re-reads every running conversation's prompt prefix once, at its next rotation.

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

Every factory pattern now compiles on Node 22 and older engines too: case-insensitive words are spelled as letter classes instead of the ES2025 inline modifier `(?i:…)`. A stored rule whose pattern the server's runtime cannot compile is skipped when commands are matched, logged once per rule and pattern, and marked on the security page with its reason; stored rules are left as they are. The server and the CLI stop at start on a Node older than 24 and name the version they found. The rule list becomes a paged table with aligned columns (ten rules a page, the pager and Save held under it), and a save the server refuses over one pattern turns to that rule's page and marks its row.

## SDK

`ApproveFn` takes an optional second argument, `context?: { reason?: ApprovalReason }`. `Session.run`'s policy wrapper calls the host's callback with `{ reason: { kind: "policy", rule } }` for an `ask` hit, and with the call alone otherwise. The engine never reads the reason. A host that sees a reason puts the call to a person whatever its approval mode. A callback written for the one-argument signature still compiles, and decides an `ask` hit like any other call. A subagent's reason travels through the callback it inherits, and `Session.setSubagentApprovalFallback` now wraps the fallback sink with the command policy. The server's `approval_request` event carries the same `reason` for such a call, and the `approval_decision` record is unchanged.
