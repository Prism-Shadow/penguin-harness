# Retries tell the model what failed

- **Date:** 2026-10-11
- **Type:** feature
- **Scope:** `core`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)

[中文版](2026-10-11-retry-carries-error.zh.md)

An automatic reconnect used to resend the turn's input with a `[turn_retried]` block holding the partial output and nothing about the failure itself, so the model continued as if nothing had happened.

- The `[turn_retried]` block now ends with one `[request_error code="…"]…[/request_error]` line: the latest failure's error code and the provider's or transport's error text exactly as it came (an idle timeout has a code and no text). The block is rebuilt on every attempt, so a turn retried several times carries one such line, not one per attempt.
- A `[turn_aborted]` block built after a failed request (`fatal`, or exhausted retries) carries the same single line, so the next message or a Retry tells the model why the turn is being sent again. A merged block's older line is dropped first; a user interruption leaves none.
- The default system prompt's `# System markers` section explains the line: read the quoted error before carrying on, and change course if it names something fixable rather than repeat the same request. The config kernel advances to `2026-10-11`; an Agent whose prompt tab is still the default takes the new wording through the kernel update.
- The rejected-image note goes back to fixed text; the provider's words ride in this line instead of in every note.
