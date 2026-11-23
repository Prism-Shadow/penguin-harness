# The messaging, session, observability and trace domains' services join the library packages

- **Date:** 2026-11-22
- **Type:** refactor
- **Scope:** `server`, `library/messaging`, `library/session`, `library/observability`, `library/trace`, `library/http`, `library/agent`
- **PR:** [#1718](https://github.com/Prism-Shadow/penguin-harness/pull/1718)

[中文版](2026-11-22-library-messaging-session-observability-trace.zh.md)

The server's usage statistics, schedule, messaging and trace services move beside the vocabulary packages that landed before them. `@prismshadow/penguin-library-observability` takes the usage statistics service and its date helpers; `@prismshadow/penguin-library-session` takes the schedule routes, the schedule file store and the session domain's helpers; `@prismshadow/penguin-library-messaging` takes the messaging domain's bridge and connectors; `@prismshadow/penguin-library-trace` takes the trace index, the trace service, the cost math, the reading helpers, the history wire vocabulary, the history reads' two stream legs and the trace domain's route factories; `@prismshadow/penguin-library-http` takes the socket protocol pieces and the event-stream helper; `@prismshadow/penguin-library-agent` takes the Agent State snapshot service.

The server imports these; nothing in the library imports the server. A moved service keeps its server-side assembly where it binds a server capability: the provider Modules stay, the service classes move. The API's export surface stays whole through re-exports — the in-repo forwards still in use keep the old import paths resolving — and everything else imports the library packages directly.

## Details

- `library/observability` grows: `usage-service` and its date helpers, and the error vocabulary exported from the package's index.
- `library/session` grows: the schedule routes, the schedule file store and helpers, the `ScheduleDefinition` type beside its re-export, and the organization runtime's schedule helpers' home.
- `library/messaging` (new): the messaging bridge, the Feishu, Telegram and QQ connectors and their wire vocabulary, with the messaging contract re-exported for the server's module.
- `library/trace` grows: the trace index and trace service, the cost math and the local date helper (with the pricing tier type re-exported), the trace reading helpers and the history wire vocabulary, the session history reads and their two stream legs, and the trace domain's route factories.
- `library/http` grows: the socket protocol pieces (socket frames, credit window, stream answer, line frames, SSE text) and the event-stream helper, so the socket and the trace history legs share one wire vocabulary.
- `library/agent` grows: the Agent State snapshot service.
- Every interface class involved declares its members under the `@Interface` decorator.
