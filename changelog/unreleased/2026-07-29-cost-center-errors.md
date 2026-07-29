# Cost center: the error table pages back, reads shorter, and stops logging ordinary command exits

Three changes to the error panel, which had become hard to use for the thing it exists for — finding the error that actually matters.

## The table pages back

It showed the newest 20 rows with no way further, so an error from an hour ago was simply unreachable.

A new endpoint returns any window of the history newest-first, with the filtered row count alongside it so the pager knows where the end is. Page 0 costs nothing extra — it is the batch the dashboard response already carries — so only stepping back issues a request.

The endpoint takes the dashboard's **date and agent filter only**. The model filter is deliberately not accepted: it never applied to errors in the first place (HTTP and process errors have no model dimension), so honouring it here would imply a narrowing that the summary above the table does not do. Admin-only visibility of unattributed errors carries over unchanged — a regular member paging back must not start seeing another tenant's login failures.

The pager sits outside the scroll box so it stays reachable without scrolling to the bottom of the rows, and appears only when there is more than one page. A page that fails to load shows its message and keeps the rows already on screen rather than blanking the table.

## Shorter source labels

A row's source now reads `[env] tool_failed:exec_command` instead of `environment · tool_failed:exec_command`. Only `environment` needed shortening — every other source (`http`, `llm`, `session`, `usage`, `title`, `subagent`, `process`, `schedule`) already reads at a glance — so there is one abbreviation rather than a scheme. The "most common error code" statistic uses the same shape, so the two agree.

## A non-zero exit from a command tool is no longer an error

Core mapped every non-zero exit code to a failure, and every failure was recorded. But a non-zero exit is how shell commands return information, not a fault: `grep` exits 1 when nothing matches, `test -f` when the file is absent, `diff` when files differ. Recording those turned the error table into a log of ordinary Agent work, burying real errors and consuming both the row cap and the deduplication window that exist to protect them. The Agent already sees the exit code and adjusts; nothing in it needs a human.

Both command tools are covered, not just the obvious one: the tool that polls a backgrounded command reaches the same exit-code mapping, so excluding only the foreground path would record the same command's non-zero exit depending on how it happened to finish.

What is dropped is keyed on the note the tool appends (`[exit code: N]`), not on the tool's name — the same `failed` status also covers faults no Agent can adjust its way out of: a command killed by a signal (an OOM-killed build, a segfaulting test binary), a spawn failure (nonexistent working directory, EMFILE, an unresolvable shell), a tool timeout, or a missing command-session manager. Those still record, and they are exactly the "needs a human" cases the table exists for.

The exclusion happens where errors are captured rather than where they are queried, so the noise never reaches the table, the row cap, or the deduplication key. The paged route's tenant isolation is now covered by tests as well: an outsider gets a 404, a traversal id gets a 404, and a member paging through offsets never reaches another tenant's rows even with foreign records interleaved into the same pages.
