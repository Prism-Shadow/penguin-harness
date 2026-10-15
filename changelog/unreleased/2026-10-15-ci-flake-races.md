# Benchmark placement and Chrome reconnect races, and lighter server test fixtures

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `ci`

[中文版](2026-10-15-ci-flake-races.zh.md)

Fixed two races that failed CI runs at random, and removed the fixture weight that had made the server suite several times slower on the Windows and macOS runners.

## Details

- Benchmark placements into one Project's `benchmarks/` made by one process run one at a time. Two overlapping overwrites of one id could leave a moved-aside copy under `.seeding/` for good, and one placement could remove `.seeding/` while another was about to stage in it. Overwrites of one id sent at once now all land, in the order they were sent.
- The Chrome extension's link counts as connected only once its connect listeners have run, the tab list refresh among them. A status read during a reconnect no longer reports the browser available with the tab list from before the disconnect.
- Server tests: `createTestApp` writes no built-in Benchmarks into the Projects it creates unless a scenario asks for them (`builtinBenchmarks: true`). They were most of the files each test app and each provisioned user wrote. Production writes them as before, through the new `BuiltinBenchmarkSeeds` interface.
- The terminal prompt-hook scenarios wait for a trap's output before typing the next command, and the web form-commit and native-title guards parse each file once and skip files that cannot hold what they look for.
