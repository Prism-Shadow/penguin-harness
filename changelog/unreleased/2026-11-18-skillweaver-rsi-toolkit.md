# The SkillWeaver toolkit hones website skills into tested API scripts

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **Issue:** [penguin-harness-community#74](https://github.com/Prism-Shadow/penguin-harness-community/issues/74)

[中文版](2026-11-18-skillweaver-rsi-toolkit.zh.md)

Added the SkillWeaver RSI Toolkit, `skillweaver-rsi-toolkit`, reproducing SkillWeaver: Web Agents can Self-Improve by Discovering and Honing Skills (Zheng et al., 2025, [arXiv:2504.07079](https://arxiv.org/abs/2504.07079)), read against the reference implementation at `f2a63d65`. Like the other algorithm toolkits it is one Skill of the plugin's own name, carrying the method and focused references; unlike them it also ships two small scripts, because the method's product is executable code.

## The practice loop

- Every iteration starts on the website's home page and either explores or tests, by upstream's `test_probability` of 0.5.
- Exploring, a Proposer lists skills worth having from the page, the library and the site knowledge, rates each for usefulness and action count, and picks the best; on a live website it discards anything that would create accounts, publish, reserve, contact support or otherwise affect other users.
- Testing, the untested API is chosen by upstream's softmax over practice utility (interaction count minus version), and a Tester generates arguments from the page.
- The Target attempts the task in the agent browser. A test passes when its call of the API succeeds; any other attempt goes to a Judge on the Trace and the final screenshot, and an admitted one to the Synthesiser, which writes new or updated API scripts with a usage log and rewrites the site knowledge. A failed attempt writes nothing.

## The skill library

- The Target's library is a target-owned Skill, `skillweaver-apis`: an index of API scripts with signatures, documentation, test counts and usage logs, the scripts themselves, and a feature-centric description of the site, read through one fixed `AGENTS.md` line.
- An API is a Node module over `penguin browser`, the counterpart of upstream's Playwright skill function: it starts by opening a site-relative path, takes typed, human-readable parameters, and prints one JSON result line. The shipped runtime runs it and checks its arguments; on Windows it starts the CLI from the server's `penguin.cmd` shim directly, so no browser script passes through cmd.exe.
- `skillweaver.mjs` is the controller's tool: code verification (syntax, the only allowed import, naming and parameter rules, a relative first navigation, at least two browser calls), library records, the practice-utility choice and the index. A script that fails a check goes back to the Synthesiser with its problems, up to 10 attempts as upstream does, and is dropped if it still fails. The library carries a fingerprint the controller checks before and after every practice cell and role call, so only the Publish step can change it. Around every measured cell the controller also compares the Target's State before and after (`state-diff`, which allows only the files a run writes itself) and audits the cell's Trace for any host other than the site and any forbidden file (`trace-audit`); a cell that fails either is rerun alone, up to three times, and scores 0 after that. The run reports which of its limits are enforced and which are instructions.

## Packaging

The plugin declares its card, its one Skill and its icon in `src/index.ts`, compiled to `ifaces.json`, with `preinstall: false`. It is registered for server, CLI, desktop and landing packaging, in the bilingual plugin catalogs and in the website's algorithm list. Its tests cover the runtime against a stand-in `penguin`, every verification rule, the library records and the documented API example; its evaluation reference is the common copy.

The toolkit is self-contained: it creates the Target Agent's skill library, runs the practice loop, evaluates its own cells and writes the Evaluation Center's scoreboard. It needs the agent browser, so it runs where the desktop app or the paired Chrome extension is available.
