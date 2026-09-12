# The hook tests stop failing on Windows when a script is still exiting

- **Date:** 2026-09-12
- **Type:** process
- **Scope:** `core`, `ci`

[中文版](2026-09-12-windows-hook-temp-lock.zh.md)

`test-windows (core)` failed intermittently in `hooks.test.ts` with `EBUSY: resource busy or
locked, rmdir`, taking whole runs red on branches that had not touched hooks at all. The teardown
was racing the operating system rather than the code under test, and the retry CI already performs
could not help, because the same race is there on the second attempt.

## Details

- Windows holds a directory locked while any live process is still using it, including a script it
  has not finished exiting from, and answers `rmdir` with `EBUSY`, `EPERM` or `ENOTEMPTY` until
  that process is gone. The five hook suites write scripts into a temporary directory, run them,
  and remove the directory as soon as the assertions pass — which can be before the last child has
  exited. The case that failed is the one that runs a hook to its timeout, so a child outliving the
  test is precisely what it arranges.
- POSIX unlinks a busy directory's entries without complaint, so nothing about this is visible on
  Linux or macOS. It appeared only in CI, and only sometimes.
- The five teardowns now retry to a deadline instead of removing once. A directory that is
  genuinely stuck still fails, one deadline later, with the error it actually got rather than a
  swallowed one.
- The retry itself already existed, written for the same reason in the MCP tests, where a stdio
  server's child holds its working directory. It moved to `packages/core/test/rm-eventually.ts` so
  both suites share one copy: a second hand-written version is how one of them ends up fixed and
  the other left racing.
