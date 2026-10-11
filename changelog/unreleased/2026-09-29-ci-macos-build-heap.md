# The macOS CI jobs build the server again

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `ci`

[中文版](2026-09-29-ci-macos-build-heap.zh.md)

The build step every CI job shares now runs Node with a 4 GB heap. On `macos-latest` the default
heap limit is 2240 MB, and the server's declaration build needs more than that, so
`test-macos (server)`, `test-macos (rest)` and `runtime (macos-latest, --mac)` failed at
`ERR_WORKER_OUT_OF_MEMORY` before any test ran. The ubuntu and windows runners already had a
4288 MB default, which is the limit every runner now gets, so their builds see no change.

## Details

- The build step prints the runner's memory and the heap limit, both the default and the one in
  effect, before it builds.
- Only the build step carries the setting; the test steps keep the runner's default.
- The desktop packaging workflow builds the workspace without the shared step, so its build
  step carries the same 4 GB heap; otherwise its macOS job would hit the same limit.
