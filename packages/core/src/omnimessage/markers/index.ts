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
 *   - **steering** (`steering.ts`): `[user_steering]`, a mid-run user message.
 *
 * `attachment-lines.ts` is the one exception to the block form: `[attached image: …]` /
 * `[attached file: …]` are single lines **appended after** a user message, naming a file the
 * model must open by path. They live here for the same reason the blocks do — core, the
 * server and the Web renderer all have to spell them identically.
 *
 * `block.ts` owns the spelling itself — the canonical square form for producers and the
 * dual-form (square + legacy angle) matching every parser applies, because markers persist in
 * Traces and in each agent's stored compaction prompt. `tags.ts` owns the tag list.
 *
 * **Consumption boundary**: marker text is addressed to the model and to the render /
 * observation layers (chat folding, the trace page, turn segmentation) — those may parse it
 * freely. Core's runtime path (engine, Session, LLM translation, resume replay) must never
 * parse marker text to tell where a message came from: source decisions there ride on
 * structured facts only — payload fields such as `sender`, and the explicit queue/state that
 * delivered the message — so core BUILDS markers but never branches on them. Transforming a
 * protocol block core itself authored (the compaction `[summary]` extraction) is not source
 * discrimination and stays legitimate.
 *
 * Everything here is pure string work: no OmniMessage envelopes, no I/O — the callers wrap
 * the result in `userText(...)` (or match against a payload's text) themselves.
 */
export * from "./block.js";
export * from "./tags.js";
export * from "./attachment-lines.js";
export * from "./engine-blocks.js";
export * from "./origin-blocks.js";
export * from "./steering.js";
export * from "./strip.js";
