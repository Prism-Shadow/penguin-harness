---
title: "Lay down rules for vibe coding to avoid code that gives you heartburn"
date: 2026-10-19
category: perspectives
excerpt: "Vibe coding moves fast but hides maintenance risk. Writing three layers of shared rules into your repo as persistent AI memory keeps speed without unnecessary pain."
---

Vibe coding is fast, but unconstrained work hides costly flaws.
GitClear analyzed 211 million changed lines from 2020 to 2024: refactor rates fell, copy-paste rose.[^1]
The 2025 DORA report found ungoverned AI lowers delivery stability.[^2]
Veracode found 45% of LLM code samples failed security tests; one Replit user reported its AI coding tool deleted his production database.[^3][^4]

We think the fix is straightforward.
Treat your repo as cross-session AI memory (code as memory), with three rule layers: human rules, interface abstractions, reusable components.

<figure class="post-figure" data-figure="vibe-rules-three-layers"> <svg class="fig-svg" viewBox="0 0 560 282" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-three-layers-en-title"> <title id="rules-for-vibe-coding-vibe-rules-three-layers-en-title">Three constraint layers stacked top to bottom, with a side note for code as memory, labeling core content for each layer</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-three-layers-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="52" y="34" width="360" height="62" rx="6" class="fig-box"/> <text x="70" y="60" class="fig-title">Human rules</text> <text x="70" y="81">Principles, proposals, code, tests</text> <rect x="52" y="110" width="360" height="62" rx="6" class="fig-box"/> <text x="70" y="136" class="fig-title">Interface abstractions</text> <text x="70" y="157">Directory layout, types, dependency contracts</text> <rect x="52" y="186" width="360" height="62" rx="6" class="fig-box"/> <text x="70" y="212" class="fig-title">Reusable components</text> <text x="70" y="233">Shared packages, Skill, plugins</text> <path d="M26 36V246" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-three-layers-en-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-three-layers-en-arrow)"/> <text x="16" y="22" class="fig-note">Harder as you move up</text> <text x="16" y="270" class="fig-note">Changes more often as you move down</text> <path d="M420 34H426V248H420M426 141H434" class="fig-bracket"/> <text x="442" y="145.5" class="fig-label">code as memory</text> </svg> <ol class="fig-steps"> <li>Human rules</li> <li>Principles, proposals, code, tests</li> <li>Interface abstractions</li> <li>Directory layout, types, dependency contracts</li> <li>Reusable components</li> <li>Shared packages, Skill, plugins</li> <li>code as memory</li> <li>Harder as you move up</li> <li>Changes more often as you move down</li> </ol> <figcaption>We write AI constraints into the repo across three layers; code and tests hold hard constraints, abstraction boundaries sit in the middle, and the component layer allows continuous iteration</figcaption> </figure>

## Pin hard rules to code and tests

This top layer holds hard team baselines. AI must follow these rules at all times.

Our RFC-style proposal format uses Rust RFCs' nine section names, one decision per document. Principles, glossary entries, and proposals are numbered sequentially. After a decision ships, design docs point back to the original proposal.[^5][^6]

Claude Code reads CLAUDE.md at session start. These files supply model context. Anthropic notes longer files consume more context and reduce adherence. Enforcing rules at runtime takes code paths and a PreToolUse hook.[^7]

PenguinHarness's append-only Trace rule follows this enforcement model. Public docs define Traces as append-only JSON Lines files. The writer uses O_APPEND for single-write persistence. One test checks old Trace files stop growing after rotation; another verifies multi-MB records write in one system call.[^8][^9][^10]

The enforcement path is shown below.

<figure class="post-figure" data-figure="vibe-rules-rule-path"> <svg class="fig-svg" viewBox="0 0 560 242" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-rule-path-en-title"> <title id="rules-for-vibe-coding-vibe-rules-rule-path-en-title">Four linear steps from rule establishment to enforcement, with a side branch marking in-session prompts as a soft constraint path</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-rule-path-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <g transform="translate(5 0)"> <rect x="10.4" y="10" width="315.1" height="36" rx="6" class="fig-box"/> <text x="168" y="32.5" class="fig-label" text-anchor="middle">Numbered principles / single-decision proposals</text> <path d="M168 46V71" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-en-arrow)"/> <rect x="78" y="72" width="180" height="36" rx="6" class="fig-box"/> <text x="168" y="94.5" class="fig-label" text-anchor="middle">Public documentation</text> <path d="M168 108V133" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-en-arrow)"/> <rect x="78" y="134" width="180" height="36" rx="6" class="fig-box"/> <text x="168" y="156.5" class="fig-label" text-anchor="middle">Code implementation</text> <path d="M168 170V195" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-en-arrow)"/> <rect x="78" y="196" width="180" height="36" rx="6" class="fig-box"/> <text x="168" y="218.5" class="fig-label" text-anchor="middle">Test assertions</text> <path d="M325.55 28H418.6V71" class="fig-link" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-en-arrow)"/> <rect x="298" y="72" width="241.2" height="36" rx="6" class="fig-link"/> <text x="418.6" y="94.5" class="fig-label" text-anchor="middle">In-session prompts (soft constraint)</text> </g> </svg> <ol class="fig-steps"> <li>Numbered principles / single-decision proposals</li> <li>Public documentation</li> <li>Code implementation</li> <li>Test assertions</li> <li>In-session prompts (soft constraint)</li> </ol> <figcaption>Hard rules cannot live only in prompts; code blocks violations at runtime, tests catch regressions in CI, and in-session prompts only act as soft reminders</figcaption> </figure>

Hard rules only set a baseline. Module boundaries are defined by the next layer's interface contracts.

## Draw minimal interface boundaries

A core interface exposes only the smallest set of capabilities it needs.
Editable agent-behavior files live only in Agent State; changes apply after the next context compaction.[^9][^11][^12]
Model selection, credentials, command policy, and approval mode sit intentionally outside this boundary.
Agents cannot change these settings via their own configuration, nor relax their own approval mode.[^13][^14][^15]

The directory and external config layout appears below.

<figure class="post-figure" data-figure="vibe-rules-agent-state"> <svg class="fig-svg" viewBox="0 0 560 290" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-agent-state-en-title"> <title id="rules-for-vibe-coding-vibe-rules-agent-state-en-title">Project directory tree separating agent-editable state directories from other project folders, with a note for server-stored config outside the tree</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-agent-state-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="68" y="119" width="419" height="22" rx="4" class="fig-s2"/> <path d="M24 28V102M24 46H38M24 74H38M24 102H38" class="fig-axis"/> <path d="M54 112V270M54 130H68M54 158H68M54 186H68M54 214H68M54 242H68M54 270H68" class="fig-axis"/> <text x="16" y="22" class="fig-code">&lt;root&gt;/&lt;project&gt;/</text> <text x="46" y="50" class="fig-code">.project_config.toml (model list / credentials / command policy)</text> <text x="46" y="78" class="fig-code">benchmarks/</text> <text x="46" y="106" class="fig-code">agents/&lt;agent&gt;/</text> <text x="76" y="134" class="fig-code">agent_state/ (config / prompts / Skill / hooks / memory)</text> <text x="76" y="162" class="fig-code">traces/</text> <text x="76" y="190" class="fig-code">scratchpad/</text> <text x="76" y="218" class="fig-code">shared_env/</text> <text x="76" y="246" class="fig-code">workspaces/</text> <text x="76" y="274" class="fig-code">snapshots/</text> <rect x="266.5" y="186" width="281.5" height="40" rx="6" class="fig-box"/> <text x="407.3" y="210.5" class="fig-label" text-anchor="middle">Server-stored: approval mode, API toggles</text> </svg> <ol class="fig-steps"> <li>&lt;root&gt;/&lt;project&gt;/</li> <li>benchmarks/</li> <li>.project_config.toml (model list / credentials / command policy)</li> <li>agents/&lt;agent&gt;/</li> <li>agent_state/ (config / prompts / Skill / hooks / memory)</li> <li>traces/</li> <li>scratchpad/</li> <li>shared_env/</li> <li>workspaces/</li> <li>snapshots/</li> <li>Server-stored: approval mode, API toggles</li> </ol> <figcaption>Directory layout is defined centrally in paths.ts; this tree shows core agent-related paths rather than the full project layout, with Agent State holding only editable files that change agent behavior</figcaption> </figure>

With directory boundaries fixed, runtime collaboration follows interface contracts.
The central context_engine talks only to Human, LLM, and Environment via OmniMessage, never parsing marker text to decide message source.[^14][^16][^17]

Boundary interactions and audit flows appear below.

<figure class="post-figure" data-figure="vibe-rules-interfaces"> <svg class="fig-svg" viewBox="0 0 560 272" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-interfaces-en-title"> <title id="rules-for-vibe-coding-vibe-rules-interfaces-en-title">context_engine at the center, interacting with three boundaries only via OmniMessage, with all approval decisions and execution results written to Trace</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-interfaces-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="16" y="10" width="244.4" height="36" rx="6" class="fig-box"/> <text x="138.2" y="32.5" class="fig-label" text-anchor="middle">Human (approval callback)</text> <rect x="299.6" y="10" width="244.4" height="36" rx="6" class="fig-box"/> <text x="421.8" y="32.5" class="fig-label" text-anchor="middle">LLM (model response)</text> <rect x="132" y="90" width="296" height="92" rx="10" class="fig-bracket"/> <text x="280" y="112" class="fig-code fig-label" text-anchor="middle">OmniMessage</text> <rect x="207.7" y="126" width="144.7" height="40" rx="6" class="fig-box"/> <text x="280" y="150.5" class="fig-code fig-label" text-anchor="middle">context_engine</text> <rect x="16" y="226" width="244.4" height="36" rx="6" class="fig-box"/> <text x="138.2" y="248.5" class="fig-label" text-anchor="middle">Environment (tool execution result)</text> <rect x="299.6" y="226" width="244.4" height="36" rx="6" class="fig-terminal"/> <text x="421.8" y="248.5" class="fig-label" text-anchor="middle">Trace (complete audit record)</text> <path d="M212.39999999999998 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-en-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-en-arrow)"/> <path d="M347.6 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-en-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-en-arrow)"/> <path d="M212.39999999999998 183V225" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-en-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-en-arrow)"/> <path d="M347.6 182V225" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-en-arrow)"/> </svg> <ol class="fig-steps"> <li>context_engine</li> <li>OmniMessage</li> <li>Human (approval callback)</li> <li>LLM (model response)</li> <li>Environment (tool execution result)</li> <li>Trace (complete audit record)</li> </ol> <figcaption>The engine only processes OmniMessage, the three boundaries each handle their own scope, and every decision leaves an audit record</figcaption> </figure>

Each tool call maps to one Human interface decision, answered by the user or their chosen approval mode.[^14][^18]
New server sessions default to allow-all.[^18][^19]
The SDK denies all calls by default without an approval callback; hook allow decisions cannot override command policy denials; all approvals and execution results write to Trace.[^12][^16][^18]

With boundaries fixed, the reusable component layer powers daily iteration.

## Reusable components keep AI building on existing abstractions

This layer is the loosest, fastest-changing.

Our bet is that reuse rules keep AI building on existing abstractions, not one-off systems that bloat the codebase.

Proposals first check: whether existing config or extension points cover the need, and whether a prior in-repo example exists.

The reuse decision path appears below.

<figure class="post-figure" data-figure="vibe-rules-reuse"> <svg class="fig-svg" viewBox="0 0 560 348" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-reuse-en-title"> <title id="rules-for-vibe-coding-vibe-rules-reuse-en-title">Reuse decision branching flow for new requirements, marking where abstractions are allowed to land</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-reuse-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="82.6" y="10" width="148" height="36" rx="6" class="fig-terminal"/> <text x="156.6" y="32.5" class="fig-label" text-anchor="middle">New requirement</text> <path d="M156.55 46V69" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-en-arrow)"/> <rect x="16" y="70" width="281.1" height="36" rx="6" class="fig-box"/> <text x="156.6" y="92.5" class="fig-label" text-anchor="middle">Check existing components / mechanisms</text> <rect x="278.4" y="124" width="112.9" height="36" rx="6" class="fig-terminal"/> <text x="334.8" y="146.5" class="fig-label" text-anchor="middle">Reuse directly</text> <path d="M156.55 142H277.4" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-en-arrow)"/> <rect x="278.4" y="174" width="219.7" height="36" rx="6" class="fig-terminal"/> <text x="388.3" y="196.5" class="fig-label" text-anchor="middle">Extend existing implementation</text> <path d="M156.55 192H277.4" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-en-arrow)"/> <path d="M156.55 106V231" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-en-arrow)"/> <polygon points="28.1,254 42.1,232 271.1,232 285.1,254 271.1,276 42.1,276" class="fig-box"/> <text x="156.6" y="258.5" class="fig-label" text-anchor="middle">Is this common across scenarios?</text> <rect x="278.4" y="302" width="265.6" height="36" rx="6" class="fig-terminal"/> <text x="411.2" y="324.5" class="fig-label" text-anchor="middle">Extract new component to shared layer</text> <path d="M285.05 254H411.2V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-en-arrow)"/> <rect x="56.4" y="302" width="200.3" height="36" rx="6" class="fig-terminal"/> <text x="156.6" y="324.5" class="fig-label" text-anchor="middle">Keep in single-business logic</text> <path d="M156.55 276V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-en-arrow)"/> </svg> <ol class="fig-steps"> <li>New requirement</li> <li>Check existing components / mechanisms</li> <li>Reuse directly</li> <li>Extend existing implementation</li> <li>Is this common across scenarios?</li> <li>Extract new component to shared layer</li> <li>Keep in single-business logic</li> </ol> <figcaption>Prioritize reuse; only abstract behavior that is truly common across scenarios, to avoid both duplicate work and over-abstraction</figcaption> </figure>

For frontend work, check the shared UI package first, reusing components where possible.

If capability is missing, extend the shared component and update callers; never copy controls or patch styles.

One-off business rules stay in their feature, never pulled early to shared layers.[^20]

Reuse rules apply across the stack. Each package keeps test doubles in one place; new tests reuse them first.[^21]

Hot reload no longer interrupts a running Task. It reuses terminal handover's registry, resource-interface gate, and parked context, adding only a data component and pointer.[^22][^23]

The optional continual-learning plugin asks child sessions to write findings worth keeping into the relevant SKILL.md, or change nothing.[^12][^24]

Rollout can start incrementally.

## Start with one rule

You do not need a full rulebook up front.

Mitchell Hashimoto describes his own practice this way. Each time he finds an agent making a mistake, he builds a fix so it never makes that mistake again.[^25]

We slot each fix into one of the three layers.

For baseline violations, add code and tests to pin hard rules. For example, add a comparison test for missed placeholder drift.[^26]

For permission overreach, narrow interfaces to cut unneeded capability.

For duplicate work, extract a shared component. Add reuse rules to the relevant Skill. Leave reasoning in PR descriptions.[^27][^28]

When AI repeats the error, skip rewriting long prompts. First add a failing test to pin the boundary.

[^1]: [AI Copilot Code Quality: 2025 Data Suggests 4x Growth in Code Clones - GitClear](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
[^2]: [Announcing the 2025 DORA Report | Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)
[^3]: [Insights from 2025 GenAI Code Security Report](https://www.veracode.com/blog/genai-code-security-report/)
[^4]: [Vibe coding service Replit deleted production database](https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/)
[^5]: [rust-lang/rfcs: 0000-template.md](https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md)
[^6]: [rust-lang/rfcs: text/0002-rfc-process.md](https://raw.githubusercontent.com/rust-lang/rfcs/master/text/0002-rfc-process.md)
[^7]: [How Claude remembers your project - Claude Code Docs](https://code.claude.com/docs/en/memory)
[^8]: [PenguinHarness docs: Sessions &amp; Traces](https://penguin.ooo/docs/sessions-and-traces)
[^9]: [PenguinHarness docs: Introduction](https://penguin.ooo/docs/introduction)
[^10]: [packages/core/src/trace/writer.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/trace/writer.ts)
[^11]: [PenguinHarness docs: Key concepts](https://penguin.ooo/docs/concepts)
[^12]: [PenguinHarness docs: The Agent Loop](https://penguin.ooo/docs/agent-loop)
[^13]: [PenguinHarness docs: Models &amp; Providers](https://penguin.ooo/docs/models)
[^14]: [PenguinHarness docs: Architecture](https://penguin.ooo/docs/architecture)
[^15]: [PenguinHarness docs: Agent API](https://penguin.ooo/docs/agent-api)
[^16]: [PenguinHarness docs: Core Interfaces](https://penguin.ooo/docs/interfaces)
[^17]: [packages/core/src/omnimessage/markers/index.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/omnimessage/markers/index.ts)
[^18]: [PenguinHarness docs: Tools &amp; Approval](https://penguin.ooo/docs/tools)
[^19]: [PenguinHarness docs: Chat](https://penguin.ooo/docs/chat)
[^20]: [.agents/skills/penguin-harness-frontend/SKILL.md](https://github.com/Prism-Shadow/penguin-harness/blob/77be09ec5b0997df6f55458fe9b04c55aff96722/.agents/skills/penguin-harness-frontend/SKILL.md)
[^21]: [.agents/skills/penguin-harness-dev/reference/testing.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/reference/testing.md)
[^22]: [PR #1060: feat(server): hand live agent state to a compatible successor](https://github.com/Prism-Shadow/penguin-harness/pull/1060)
[^23]: [PR #1059: refactor(server): move session memory into an AgentState component](https://github.com/Prism-Shadow/penguin-harness/pull/1059)
[^24]: [PenguinHarness docs: Skills &amp; Plugins](https://penguin.ooo/docs/skills)
[^25]: [My AI Adoption Journey – Mitchell Hashimoto](https://mitchellh.com/writing/my-ai-adoption-journey)
[^26]: [packages/web/test/placeholders-parity.test.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/web/test/placeholders-parity.test.ts)
[^27]: [.agents/skills/penguin-harness-dev/SKILL.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/SKILL.md)
[^28]: [.agents/skills/penguin-harness-dev/reference/changelog.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/reference/changelog.md)
