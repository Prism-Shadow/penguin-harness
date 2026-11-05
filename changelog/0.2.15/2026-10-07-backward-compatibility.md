# Backward compatibility: Traces and callers from before the Session source was required

- **Date:** 2026-10-07
- **Type:** process
- **Scope:** `core`, `server`, `web`, `cli`
- **PR:** [#999](https://github.com/Prism-Shadow/penguin-harness/pull/999)

[中文版](2026-10-07-backward-compatibility.zh.md)

[A Session's source became required](2026-10-07-session-source.md), and `benchmark` was retired. Two things outlive the release: the Traces already on disk, and the callers that still send the retired value.

## The old shape: a `session_meta` with no `source`, or with `benchmark`

A Trace written before this release carries no `source` for a person's conversation and for a company mode desk or ticket Session alike, and `benchmark` for a Test Session that `penguin run --source benchmark` started. The server's derived `trace_sessions` cache holds the same values, or NULL. Traces are never rewritten. Every read of a Trace head narrows the value through `normalizeSessionSource` in `packages/core/src/omnimessage/source.ts`: no `source` reads as `user`, `benchmark` as `cli`. That covers the startup adoption of unindexed Traces, a resumed Session, which records the narrowed value in every context it opens afterwards, a subagent's forwarded meta, and a child Session's meta replayed in the Web App.

Where the server also has the Session's index row, a head with no `source` reads by the row's `client` instead: `company` when the row is stamped `client = "org"` (company mode's organization runtime opened it, or its next pass stamped it), `user` otherwise. The rule is `readRecordedSource` in `packages/server/src/runtime/session-sources.ts`; the trace index keeps such a head's source as NULL so that the rule can apply. It covers the sessions list's classification, the single-Session read and the Agent Trace listing, so an old desk or ticket Session stays out of the session list like a new one. A resumed old desk still records `user` in the contexts it opens afterwards, since core sees only the Trace; the list reads the earliest head, which it never rewrites.

Two callers still send the retired value, and both are accepted with the same meaning until the removal below:

- `POST /api/projects/:projectId/agents/:agentId/sessions` with `source: "benchmark"`, from an older CLI or Web App, creates a `cli` Session.
- `penguin run --source benchmark`, which installed copies of the agent-evaluation skill still pass, runs as if the flag were absent and prints a one-line note. Any other `--source` value is an error.

A new-chat draft an older Web App left in the browser with the evaluation mark loses the mark when it loads and creates an ordinary conversation; no code is kept for it.

**A user is not required to do anything.** Old conversations list in the folders their kind belongs to, old desk and ticket Sessions stay out of the session list, and an installed evaluation skill keeps working until it is updated.

## When this can be removed

At the 0.3.0 release preparation, by whoever prepares that release. Reading a Trace never rewrites its head, so a Session created before this release keeps a head without `source` for good: dropping the `undefined` branch alone would make every such conversation a malformed head, skipped by adoption and refused by resume. The preparer therefore settles one question with the user first: rewrite the old heads once (a migration that sets `source` from the narrowing, writing `company` where the index row is stamped `client = "org"` and `user` elsewhere), or keep that one branch permanently. The `org` rule goes with that branch and is settled by the same answer. The `benchmark` branch and the aliases below can go either way. The removal takes out:

- the `compat(0.3.0)` branches of `normalizeSessionSource` (the `undefined` one only after the question above is settled); a head without a valid source is then a malformed head, skipped by adoption and refused by resume, as a head without `provider` is;
- with the `undefined` branch, the `compat(0.3.0)` branch of `readRecordedSource` (`packages/server/src/runtime/session-sources.ts`) and the NULL the trace index keeps for a head without a source (`packages/server/src/services/trace-index.ts`, `packages/server/src/db/repos/trace-index.ts`); the reading of an `org` row that has not run yet (`unrunSource`) is not compatibility and stays;
- the `benchmark` alias in the create route (`packages/server/src/http/routes/sessions.ts`);
- the hidden `--source` option of `penguin run` (`packages/cli/src/commands/run.ts`) and its two messages in `packages/cli/src/i18n.ts`;
- the cases for these in `packages/core/test/session-source.test.ts`, `packages/server/test/session-source.test.ts`, `packages/server/test/trace-index.test.ts` and `packages/cli/test/server-commands.test.ts`.
