# Roles

Every role is one `run_subagent` call (omit `agent_id`, so the role is your own Agent and can read this file), each in a fresh context, on your own model. Its prompt is the block given below with the paths filled in, and nothing else: no advice, scores, Benchmark cases or other iterations' outcomes. A role reads only the inputs its block names and replies as it says; keep each request and raw reply in `OUT/iter_<n>/`. A reply that is not in the asked form is asked once more of the same role, never repaired by you. A role's read limits are instructions: nothing stops a role from reading more, so the controller checks what matters itself (the library fingerprint before and after each call, see the Skill's integrity checks) and discards an output whose Trace shows it read a Benchmark case, a rubric or a score. Paths are those of the Skill's "Paths and records". The instructions are adapted from upstream's `skillweaver/templates/` (see `source-notes.md`).

The website is operated only by the controller's home-page step and by the Target in a practice or test cell. In all four roles, do not use `penguin browser`, Playwright, `curl`, HTTP requests, or any other means to access the site. Work from the supplied files. When a Trace is needed, local commands may print excerpts from that named Trace to standard output without running anything recorded in it. Do not write scratch files in the shared Workspace. The Synthesiser may write the requested candidate and site knowledge files in the supplied reply directory. The Synthesiser must not run a candidate, invoke the checker, or stage a test runtime. The controller checks candidates during Publish, and a later Target cell tests a registered API. Before using a role reply, inspect the role Trace for site access or candidate execution. If either occurred, preserve the request, raw reply and offending tool call, discard the output, and stop the run.

Validate the complete final assistant reply. Streaming tool output can include intermediate assistant narration or tool events. Use the role's final assistant text from its Trace when the output stream does not delimit it. If the final text contains prose around the JSON, ask the same role to resend it as specified.

## Proposer

Explore iterations. Upstream: `propose_skill.md`, `_choose_explore_task`.

```text
Read <SKILL_DIR>/references/roles.md, section "Proposer", and act as the SkillWeaver skill proposer. Reply with the JSON only.
library: <APIS>/INDEX.md
site_knowledge: <LIBRARY>/site.md
page_text: <OUT>/iter_<n>/page.txt
screenshot: <OUT>/iter_<n>/page.png, or none
live_site: <true|false>
```

As the Proposer, you are a web agent learning how to use this website. You write "skills" (shortcuts) for common tasks on it. Read the library (the skills already proposed and learned), the site knowledge, the page text and the screenshot. Come up with something new to learn how to do on this website. Do not interact with login, logout or user accounts.

Write a list of useful skills that you would want built into the website as functions; name each in natural language. Do not use an id as a parameter. They should be shortcuts for users of the website: prefer skills that compress a couple of interactions into one call, for actions a user might realistically want to do. Prefer skills that create, modify, or filter and query data on the website, as these tend to be more useful. Do not propose a skill that is a single click.

When `live_site` is true, discard any skill that involves the creation of user accounts; publication or submission of content; reservation of time slots, tickets, event slots or other scarce resources; submission of support requests or feedback; interaction with promotional material; or anything else that could affect other users of the website. Then list the skills that satisfy these criteria.

For each skill estimate (1) how useful it is, 5 for difficult and frequent, 1 for trivial or uncommon, and (2) the expected number of clicking and typing actions it needs (write the list of steps and count them afterwards). Add the two ratings for each skill and select the skill with the highest sum. Reply `{"step_by_step_reasoning": "<your ratings>", "proposed_skill": "<the chosen skill, as a task to perform now, with concrete values>"}`.

## Tester

Test iterations. Upstream: `generate_practice_args.md`, `_generate_test_case_arguments`.

```text
Read <SKILL_DIR>/references/roles.md, section "Tester", and act as the SkillWeaver test-argument generator. Reply with the JSON only.
api: <APIS>/<name>.mjs
page_text: <OUT>/iter_<n>/page.txt
screenshot: <OUT>/iter_<n>/page.png, or none
```

As the Tester, you are a web agent learning how to use this website. The API file holds an untested automation: its `meta` gives its name, documentation, parameters and usage log. Because it is untested, you want to test it now. Generate reasonable arguments for every parameter, based on what the page shows: values that exist on the website. Test new arguments when the usage log shows that some have been tried already. Reply `{"step_by_step_reasoning": "…", "args": {<one value per parameter of meta.params, of its type>}}`.

## Judge

Every attempt that is not a passing test. Upstream: `check_success_simple`.

```text
Read <SKILL_DIR>/references/roles.md, section "Judge", and act as the SkillWeaver success checker. Reply with the JSON only.
task: <the Task line of the practice README>
trace: <its root Trace files, TARGET/traces/*/<session_id>_*.jsonl>
final_screenshot: <the Workspace's final.png, or "none">
```

As the Judge, observe the action log of someone using a computer: the tool calls, commands, outputs and observations in the Trace, and the screenshot of their screen at the end of their attempt. They were trying to do the task given. Read only these inputs. Decide from what was actually done and observed whether they were successful: a claim in their last message is not evidence, and when the evidence does not show success, the answer is `false`. Reply `{"step_by_step_reasoning": "…", "success": true | false}`.

## Synthesiser

Every attempt the Judge admits. Upstream: `kb_procedural_update_base.md`, `kb_procedural_update_single.md`, `kb_semantic_update.md`, `KnowledgeBase.update`.

```text
Read <SKILL_DIR>/references/roles.md, section "Synthesiser", and act as the SkillWeaver API synthesiser. Work offline from the supplied files. Do not browse, execute or test your scripts, or invoke the checker. Reply as the format specifies.
format: <SKILL_DIR>/references/api-format.md
library: <APIS>/INDEX.md
api_sources: <the APIs that are tested, and every API the Trace shows being called: APIS/<name>.mjs, …>
site_knowledge: <LIBRARY>/site.md
task: <the Task line of the practice README>
trace: <its root Trace files>
verdict: <the Judge's reply>
reply_dir: <OUT>/iter_<n>/reply
```

As the Synthesiser, you are learning how to use a website. Besides a semantic base of knowledge you build a procedural one: API scripts that automate what was done successfully. Read the inputs and the format, and nothing else.

**Procedural.** Write skills: scripts representing the logical procedure that performed the task, for the general case of the task rather than this instance. Take a step back and think about the general procedure used, and explicitly decide what the documentation should say. Each script follows `api-format.md`. Document its behaviour carefully in `meta.description`, especially anything unexpected and useful for future callers, and keep a usage log in `meta.usage_log` of what happened when it was used here: arguments, outcome, and any feedback on success. If an existing API was used and the result was unexpected, update its documentation (a new version of the same file, same `meta.name`, every earlier usage-log entry kept). Do not write test, explore or verify scripts, nor ones that check that an earlier skill worked. Do not include steps that close cookie banners. Use human-readable parameters, not ids or URLs (unless a field on the page itself takes a URL), and do not overfit the name or the parameters to this instance; do not hard-code numbers that change, such as counts. Catch an error only when you can recover from it.

If the task does not appear to have been completed successfully, write no script: do not assume what a good one would look like.

**Semantic.** Keep a feature-centric description of the website: a section per feature you interacted with, even if it seems obvious, written as concise professional documentation in Markdown whose top heading is the website's title. Rewrite it whole with what you learned added, leaving out nothing it had. No code in it.

Write each new or updated script to `reply_dir/<name>.mjs` and the rewritten site knowledge to `reply_dir/site.md`, and nothing anywhere else. When the controller sends you the problems the checker found in a script, with your earlier attempts, rewrite that script to fix every problem named, write it to `reply_dir/<name>.mjs` again, and reply in the same form. Reply with one JSON line: `{"apis": ["<name>", …], "site_md": true | false, "reasoning": "<the general procedure and the documentation changes>"}`.
