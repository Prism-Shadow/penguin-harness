# Harbor cells refill as they return, and install from a bundle

- **Date:** 2026-10-11
- **Type:** process
- **Scope:** `plugins`, `docs`
- **PR:** [#1034](https://github.com/Prism-Shadow/penguin-harness/pull/1034)

[中文版](2026-10-11-harbor-cell-fanout.zh.md)

The `agent-evaluation` reference for Harbor cases gave the caller a dispatch loop: launch cells in the background up to the limit, end the turn, and launch the next cell in the turn that a completion notice starts. In measured GDPevo calibrations the controller had polled with `input_subagent` instead and kept 2.6–2.7 of the 4 allowed cells running on average. The shared setup also built the benchmark repository's install bundle once per checkout, so a trial's agent setup unpacked Node.js and the CLI (a median of 7 s) instead of installing them from the network (medians of 112–261 s). The four algorithm toolkits' evaluation reference said the same.

## Details

- **Limit.** A caller ran as many cells at a time as the user named for the evaluation, else four, the benchmark repository's rule: every trial takes one Docker network, and evaluations that share a machine divide its limit. It never went above eight, where the harness refuses another running background subagent.
- **Dispatch loop.** `reference/harbor.md` §A, *Running the cells*: every cell was launched with `run_subagent` and `run_in_background: true`, its prompt opening with `Caller agent: <id> — cell <case_id> run <run>` so that the completion notice named the cell. The caller kept a ledger of unstarted, running and returned cells, filled every free slot and ended its turn, then launched replacements in the turn each `[background_task_done]` notice started, without polling and without waiting for a batch. A cell Docker could not give a network went back to the head of the queue under a halved limit.
- **Install bundle.** §A gained step 10: the caller built `bundles/penguin-cli-<penguin version>-node-24.18.0-linux-<arch>.tar.gz` in the checkout with the repository's `tools/make_install_bundle.sh`, holding a `mkdir` lock that another evaluation waited on for up to 10 minutes, and went on without the bundle when the build failed. §B.7 added `--ak install_bundle="$BUNDLE"` to the launch when the file existed; a worker never built it.
- **Skills.** `agent-evaluation`'s `SKILL.md` summarised the loop and the bundle for callers, and `agent-optimization` ran every Candidate's cells as *Running the cells* says.
- **Toolkits.** The byte-identical `references/evaluation.md` of `opro-rsi-toolkit`, `ape-rsi-toolkit`, `ace-rsi-toolkit` and `awm-rsi-toolkit` ran Harbor cells in the background under the same limit, launching the next cell as one returned, and passed the checkout's install bundle when it held one.
- **Versions.** The changed Skills moved to `2026.10.12.1`: `agent-evaluation` (of the `agent-evaluation` plugin), `agent-optimization` (of `default-rsi-toolkit`), and the Skills of `opro-rsi-toolkit`, `ape-rsi-toolkit`, `ace-rsi-toolkit` and `awm-rsi-toolkit`.
- **Docs.** The Evaluation Center page's built-in Benchmarks section described the limit and its reason, the next trial starting as one finished, and the install bundle.
