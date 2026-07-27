/**
 * Special message markers — one module for every marker the product writes into message text.
 *
 * A marker is a block of the form `[tag]…[/tag]` embedded in an OmniMessage's text: it tells
 * the model (and the render layers) that this part of the conversation is machine-inserted
 * rather than something the user typed. They come in three families:
 *
 *   - **engine blocks** (`engine-blocks.ts`): `[turn_aborted]` / `[turn_retried]` transcripts,
 *     the `[context_summary]` injection and the `[summary]` the compaction prompt asks for —
 *     produced by the ReAct loop and Trace replay;
 *   - **origin blocks** (`origin-blocks.ts`): `[use_skills]`, `[handoff_from]`,
 *     `[scheduled_task]`, `[model_switch_from]` — prefixed to a user message by the hosts
 *     (Web composer, server scheduler) and collapsed into a banner when rendered;
 *   - **steering** (`steering.ts`): `[user_steering]`, a mid-run user message;
 *   - **goal** (`goal-block.ts`): `[goal]`, the goal-mode round protocol block prefixed to
 *     each round's input by the Session's goal loop (line-anchored close — see the module).
 *
 * `block.ts` owns the spelling itself — the canonical square form for producers and the
 * dual-form (square + legacy angle) matching every parser applies, because markers persist in
 * Traces and in each agent's stored compaction prompt. `tags.ts` owns the tag list.
 *
 * Everything here is pure string work: no OmniMessage envelopes, no I/O — the callers wrap
 * the result in `userText(...)` (or match against a payload's text) themselves.
 */
export * from "./block.js";
export * from "./tags.js";
export * from "./engine-blocks.js";
export * from "./origin-blocks.js";
export * from "./steering.js";
export * from "./goal-block.js";
