---
name: skillweaver-rsi-toolkit
description: Run SkillWeaver (Zheng et al. 2025) on an agent - let it explore a website on its own, propose skills worth having, practise them, and hone the successful ones into tested, reusable API scripts in a skill library, then freeze the library and measure it on a published Benchmark of tasks on that site. Use when asked to make an agent better at a website by learning skills or APIs from self-directed practice.
version: 2026.11.20.2
---

# SkillWeaver

[SkillWeaver: Web Agents can Self-Improve by Discovering and Honing Skills](https://arxiv.org/abs/2504.07079), Zheng et al., 2025. GitHub: [OSU-NLP-Group/SkillWeaver](https://github.com/OSU-NLP-Group/SkillWeaver). Verified implementation revision `f2a63d65d0f6ff46ac30e817cede8797f8f25b97`, chiefly `skillweaver/explore.py`, `skillweaver/knowledge_base/` and `skillweaver/templates/`. SkillWeaver improves a web agent with no task data: on a website it **proposes** a skill worth having, **practises** it, has a success checker judge the attempt, and **hones** each success into a parameterised API with a documented usage log; untested APIs are then **tested** with generated arguments and patched when they fail. The resulting skill library is a set of executable APIs the agent calls on later tasks. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill needs `run_subagent`, so it runs in a top-level Session. It also needs the agent browser: run `penguin browser status`, and when it is unavailable, tell the user what its `note:` says and stop. If the message only names this Skill, ask which agent to train and on which website. Otherwise resolve the inputs below and ask only for what is missing; everything else has a default.

- `test_agent_id` - the Target: an existing agent of this Project, or `create: <id>` when the user wants a fresh one, created with no plugins but `browser-automation` by `penguin agent create --agent-id <id> --project-id "$PROJECT_ID" --plugins browser-automation --json` (an id matches `^[a-z][a-z0-9_-]{1,63}$`). If that id exists already, stop and ask; never reinitialize an agent. The Target is never the agent you run as. It must be able to use `penguin browser`: an existing Target without the `browser-automation` Skill is a stop, not something to install silently.
- `site_url` - the http(s) address of the website to practise on: its home page, where every iteration starts. A sign-in the site needs is done by the user in the agent browser before you start; never type a password yourself.
- `live_site` - `true` (default) for a public website other people use, which turns on upstream's safety rules for proposals (below); `false` only for a sandboxed copy the user owns, such as a WebArena container.
- `iterations` - practice iterations; default 10 (the smoke budget). The paper explores for 160.
- `test_probability` - the chance that an iteration tests an untested API instead of exploring; default 0.5, upstream's `test_probability:0.5`.
- `benchmark_id` (optional) - a published Benchmark of this Project whose cases are tasks on the same site: H1 (the empty library) and the final library are measured on it. Without one, the run reports the practice log and the API tests only, and says that nothing was measured. Never practise on its cases: SkillWeaver proposes its own tasks.
- `runs` - runs per case in every measurement; default 1, or the request's `test_repetitions`. One run checks the pipeline; a claim that the library helps needs at least 3, and the report gives every run, the mean and the spread.
- The runtime - the `provider` / `model_id` pair the user names, else your Environment's, fixed for the whole experiment (`references/evaluation.md`, controller step 2). The Proposer, Judge, Synthesiser and Tester run on your own model; record it.

Budget, for I iterations, C cases and R runs: I practice cells of the Target, at most I Proposer or Tester calls, at most I Judge calls and at most I Synthesiser calls; with a Benchmark, `2 × C × R` cells more for H1 and the final measurement. Before the first practice cell, show the user the plan (site, `live_site`, iterations, the Benchmark if any, these numbers) and wait for their go-ahead: a quick-start prompt is not one. Never launch a larger budget implicitly.

## Paths and records

Resolve every path from your Environment's `App Data Dir`; never search for the Project:

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>
SKILL_DIR    = PROJECT_DIR/agents/<your Agent ID>/agent_state/skills/skillweaver-rsi-toolkit
TOOL         = node SKILL_DIR/scripts/skillweaver.mjs
LIBRARY      = STATE/skills/skillweaver-apis     # SKILL.md + site.md + apis/, the only learned slot
APIS         = LIBRARY/apis                      # library.json, INDEX.md, skillweaver-api.mjs, <name>.mjs
OUT          = <this Session's scratchpad>/skillweaver-rsi-toolkit/<experiment_id>
```

`<experiment_id>` is `<test_agent_id>-<UTC time as YYYYMMDDTHHMMSSZ>`. Before the first practice cell, write `OUT/experiment.yaml`; its `dimensions` place the run in the Awesome-RSI taxonomy:

```yaml
method: SkillWeaver
paper: "SkillWeaver: Web Agents can Self-Improve by Discovering and Honing Skills"
arxiv_url: https://arxiv.org/abs/2504.07079
github_url: https://github.com/OSU-NLP-Group/SkillWeaver
source_revision: f2a63d65d0f6ff46ac30e817cede8797f8f25b97
settings: { iterations: 10, test_probability: 0.5, live_site: true, max_actions: 10, return_home: every iteration }
site_url: <url>
test_agent_id: <id>
benchmark_id: <id or null>
runs: 1
runtime: { provider: <provider>, model_id: <model_id>, thinking_level: <level> }
roles_model: { provider: <your Provider>, model_id: <your Model ID> }
h1: { version: <n>, sha256: { <every file of STATE but .vault.toml>: <hash> } }
dimensions:
  artifact: skill library (executable API scripts + site knowledge)
  source: self-proposed practice on the website, no task data
  feedback: success Judge on each practice attempt; API execution for tests
  updater: API Synthesiser (procedural) and site-knowledge rewrite (semantic)
  frequency: per successful practice attempt
  topology: sequential exploration, one Target, one browser
  selection: code verification and testing; the final library is kept
  mode: online exploration
  scope: the skillweaver-apis Skill
adaptations: []
```

Keep in OUT, per iteration `OUT/iter_<n>/`: the choice (`choose.json`: explore or test, the proposal or the API and its arguments, utilities), the practice README, the session id, the Judge's verdict, the Synthesiser's request and raw reply, the check results, and every published API version under `OUT/library/v<version>/`. Keep `OUT/state.yaml` (next iteration, phase, State version) so that a compacted or resumed Session continues the run instead of restarting it.

Snapshots: before the first change to a measured State, make sure `TARGET/snapshots/v<version>.tar.gz` exists: an archive of `agent_state/` without `.vault.toml`, its entries rooted at `agent_state/`. Never overwrite one, and stop if it cannot be created. State versions only increase and are never reused.

## Initialize

Follow `references/initialization.md`. It creates the empty skill library Skill and one fixed reader line in the Target's `AGENTS.md`, and changes nothing else. The initialized State is H1.

## Measure

With a `benchmark_id`, every measurement is a full case × `runs` matrix through `references/evaluation.md`, following its controller section, and lands in that Benchmark's `scoreboard.yaml`. Measure H1 before the first practice cell. A prior record is reusable only when its State version, case set, runtime and runs all match. Practice cells are never scored and never enter a scoreboard. Before and after each measurement matrix, record `TOOL fingerprint STATE`. The Target must keep its State read-only, including memory, throughout measurement. If the fingerprint changes, retain the records, mark the matrix invalid, and stop. Review the Target Traces for direct access to the website outside `penguin browser` or its registered API scripts. Preserve any affected cells and invalidate the matrix if that access occurred.

### The same site for both measurements

Practice changes a sandboxed site (it creates, edits and filters data), so H1 and the final library would otherwise be measured on different sites. With `live_site: false`, the user names how the site is reset to one fixed snapshot (for a WebArena container, restoring its image); reset it before H1 and again before the final measurement, and record the command and the time of each reset. If it cannot be reset, say so in the report next to the scores. A live site drifts on its own: measure H1 and the final library close together, and report that the two ran on a moving site. Both measurements use the same browser profile and sign-ins, and nobody else uses the agent browser while a cell runs. Run every cell, measured or practice, one at a time, though `references/evaluation.md` allows a frozen State's cells in parallel: the agent browser is one shared set of tabs, and two cells would act on each other's pages.

## Integrity checks

These are the checks the run enforces itself, not instructions to anyone:

- **The library changes only through Publish.** After every Publish, record `TOOL fingerprint LIBRARY` in `OUT/state.yaml`. Before and after every practice cell and every role call, compute it again; any difference you did not publish is a stop (`a Target edit to LIBRARY` or `a role edit to LIBRARY`), and the changed files are named in the report.
- **No Target State changes during a practice cell.** Immediately before and after each practice cell, save `TOOL fingerprint STATE` in that iteration's records, in addition to the library fingerprint. If the State differs (including memory), record the changed paths and stop before judging or publishing. The check detects changes after execution and does not restrict the Target's tools.
- **The runtime is the shipped one.** Before every practice cell, `TOOL verify-runtime APIS` must report no problem.
- **Every API passed the checker.** Only files `TOOL check` accepted are registered, and `INDEX.md` lists registered APIs only.

You never edit anything under `SKILL_DIR`, and never pass a setting the user did not give or this Skill does not name.

## The practice loop

Iterations are sequential: one browser, one Target, each iteration using the library the ones before it built. For iteration `n` = 0, 1, …:

1. **Go home.** `penguin browser open <site_url>` (upstream returns to the base URL every iteration). Save `penguin browser scan --text --max-chars 12000` as `OUT/iter_<n>/page.txt`, and try `penguin browser screenshot -o OUT/iter_<n>/page.png`. A screenshot is optional: a page the desktop's Browser panel does not show is parked off-screen and renders no frame, so the command times out for background cells; then the roles get `screenshot: none` and work from the page text, and the report counts the iterations that had no screenshot.
2. **Choose.** Draw `u` with `node -e 'console.log(Math.random())'` (never pick it yourself) and record it. When `u < test_probability` and `TOOL pick-test APIS --seed <n>` names an API, this is a **test** iteration: run the Tester on that API (`references/roles.md`); an API with no parameters needs no Tester and is tested with `{}`, as the paper runs such an API directly as a unit test. Otherwise it is an **explore** iteration: run the Proposer. Write `OUT/iter_<n>/choose.json`.
3. **Practise.** Run one practice cell (below) with the task: for explore, the proposed skill; for test, `Test the API <name> with the arguments <json>`.
4. **Update.**
   - A test whose Trace shows the Target calling that API with exactly those arguments and the call printing `{"ok":true,…}` passes: `TOOL tested APIS <name> iter_<n>`, then `TOOL index APIS`. Nothing else changes.
   - Otherwise run the Judge on the attempt. When it answers `success: true`, run the Synthesiser on it and Publish what it returns. A failed attempt changes nothing: upstream writes no function from an unsuccessful attempt.
5. **Record** `OUT/state.yaml` and go on. An iteration that fails for an infrastructure reason (the browser became unavailable, the cell never started) is retried once after the cause is fixed; it never counts as a failed attempt.

### Practice cell

A practice cell is one execution of the Target in a fresh Workspace, the launcher of `references/evaluation.md`, worker step 2, with no rubric and no score. Create a unique directory under `TARGET/workspaces/`, write its `README.md` as below, and launch `penguin run` there with `run_in_background` (a practice attempt outlasts `exec_command`'s two minutes); wait for it to exit. Bind its root Trace as the worker does and keep the session id. Before judging or updating, review the tool calls for direct website access outside `penguin browser` and the registered APIs. If found, record the offending call and treat the attempt as unsuccessful regardless of its final message.

```markdown
# Practice task

Website: <site_url>
Task: <the proposed skill, or "Test the API <name> with the arguments <json>">

Use only `penguin browser` and the registered SkillWeaver APIs that invoke it to access this website. Do not use `curl`, `wget`, shell or Node HTTP clients, other browser tools, or network requests inside browser scripts to fetch pages directly. This applies to verification and fallbacks too. Use at most 10 browser actions. If you cannot finish within these limits, report what remains. Your Agent State is read-only for this task, including its memory and memory index. Do not save observations, corrections, or discoveries to memory. Write any task output only in this Workspace.
<for a test: Call it exactly as INDEX.md describes, with these arguments, and report its output.>
<when live_site: Do not create accounts, publish or submit content, reserve anything, contact support, or do anything else that could affect other users of the website; stop instead.>
When you are done, try `penguin browser screenshot -o final.png` in this Workspace (skip it if it fails; it is optional) and say in one or two sentences what you did and whether it worked.
```

Never put a Benchmark case, a score or another iteration's outcome in it.

### Publish

Only you write `LIBRARY`, and only while no cell runs. For each API file the Synthesiser returns:

1. Write it to `OUT/iter_<n>/candidates/<name>.mjs`, copy it into `APIS` (a new file, or a new version replacing the old one), and run `TOOL check APIS/<name>.mjs`. A version that drops a documented usage-log entry of the one it replaces is a problem too. A file with any problem is removed again (the previous version, if any, restored) and its problems recorded; never repair it yourself. Instead, as upstream's `KnowledgeBase.update` does, send the same Synthesiser (`input_subagent` on its Session) the code and the problems of every attempt so far and ask it to write that file again, up to 10 attempts in all; a file that still fails after the tenth is dropped and recorded.
2. For each that passed, `TOOL register APIS <name> iter_<n>` (a new version starts untested).
3. When the reply carries site knowledge, replace `LIBRARY/site.md` with it, unless it lost a section the old one had (then keep the old one and record it).
4. `TOOL index APIS`; then bump the `skillweaver-apis` Skill's `version` (the next `N` when it carries today's date, else today's `.1`) and the State `version` in `STATE/system_config.yaml` by 1, replacing the field rather than adding a second one; parse both back, and copy `LIBRARY` to `OUT/library/v<version>/`.

A reply that adds nothing that passes publishes nothing. There is no cap on the number of APIs.

### Stops

Stop when the budget is spent, when the browser stays unavailable, when an integrity check fails, on `version_changed` or `benchmark_invalid`, on an `evaluation_failed` with no repair left, on a runtime mismatch, on a Target edit to State during practice, when a role Trace shows it drove the website or executed a candidate API (discard the role output before Publish), and when a Benchmark case, a rubric or a score enters a role's context (discard that output as contaminated). The last published State stays; never publish a partial or contaminated change, and say what stopped the run.

## Freeze and report

After the last iteration the library is frozen: no proposal, synthesis or library write while measuring. The live State is the final library, kept whatever it scores. Make sure its snapshot exists, then measure it on `benchmark_id` when given, with a `summary_title` such as `SkillWeaver · final library, 5 APIs (3 tested) · 64.00`.

Report:

- the site, `live_site`, the settings, and the budget used against the plan, with every stop or retried iteration;
- the H1 and final State versions and the final library: each API's signature, version, test count and usage log, and every API dropped by the checks with its problems;
- the practice log iteration by iteration (explore or test, the task, the Judge's verdict, what was published);
- with a Benchmark, the baseline and final scores per case, and the APIs the Traces show the Target calling (a read is not a use, and a use is not a gain); without one, that nothing was measured;
- the cost of every role and cell from the Sessions' recorded usage, including retried iterations, failed cells, the Synthesiser's regeneration rounds and role output discarded as contaminated;
- what is enforced and what is only an instruction: the library fingerprint, the State fingerprints around practice cells and measurement matrices, the runtime check and the code check are checked at run time; role scope, direct-network restrictions, live-site safety rules, the 10-action limit and the Target's duty to keep State read-only during execution are instructions. A role's Trace can show out-of-scope actions, but the audit does not prevent them. The code check is a quality gate, not a sandbox: an API runs with the same rights as the Target's own shell;
- the source links and revision, and every adaptation: APIs are Node scripts over `penguin browser`, not Playwright Python; the agent is the Target with its own tools, not upstream's code-generating agent, and the 10-action limit is an instruction, not enforced; the Target picks APIs by reading `INDEX.md`, not through upstream's retrieval call; the success checker is an agent Judge on the Trace and, when one could be taken, the final screenshot, where the paper's reward model also sees a screenshot per step; the Proposer and Tester see a screenshot only when the browser could render one (a page outside the Browser panel cannot), else the page text alone; exploration is sequential, one attempt per iteration; the paper's information-seeking proposals and scraping prompts (§2.1, Appendix A.7) are not used, as upstream's exploration loop does not load them at this revision; upstream repairs a failing locator inside the call (`allow_recovery`) and feeds those repairs to the update, while here the Target works around a failing call with its own tools and the Synthesiser updates the API from that Trace. This is not a reproduction of the paper's WebArena numbers.
