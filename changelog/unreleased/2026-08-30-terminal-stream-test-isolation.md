# The terminal stream suite kills each test's shells before the next test

- **Date:** 2026-08-30
- **Type:** process
- **Scope:** `server`, `tooling`

[中文版](2026-08-30-terminal-stream-test-isolation.zh.md)

`terminal-stream.test.ts` shares one app across its tests and opened fourteen `/bin/sh` shells that nothing closed, against a registry that caps a user at twelve live shells. It fit under the cap only when enough earlier shells had exited on their own, so it passed on one runner and answered `429` on a slower one. Each test's terminals are now deleted after it, and the next test waits until the registry reports none alive.
