# Evaluation Center restores the selected Benchmark

The Evaluation Center now remembers the last selected Agent and Benchmark for each user and Project, so following a Run's Session link into Trace Observability and returning through the sidebar restores the Benchmark instead of showing the empty initial state.

Only the stable Agent and Benchmark ids are kept in browser storage. The current Benchmark summary is fetched again before restoration, invalid or stale selections are ignored, account and Project changes are isolated, and explicit `?agentId=` deep links retain their existing focus behavior. Unit coverage exercises storage validation and isolation, while a browser regression test follows the original Evaluation Center → Session trace → Evaluation Center path.
