---
name: humanizer
description: Rewrite or edit prose in any language so it reads like edited human writing in the register of books, newspapers and encyclopedias rather than default AI output. A small drafting core — vary every pattern, build density from anchored facts in whole grammar, cap the quotables, put a real writer with real material behind the text, let structure serve content, write each language from inside its idiom and typography, verify what you assert, and aim for the natural distribution of edited prose rather than a perfect scorecard — backed by a three-layer tell catalog, per-language cue files for six languages and a seven-round measured case study shipped as reference files for the diagnostic census.
short_description: Strip AI-writing tells from prose in any language.
short_description_zh: 去除文本的 AI 味，把行文改成书籍、报纸、百科式的风格，任何语言通用。
version: 2026-08-12.1
---

# Humanizer

Make prose read like edited human writing: the register of books, quality newspapers and encyclopedia entries. Everything here was derived empirically, across seven rounds of drafting, blind editorial review and revision, documented with counts in [`reference/case-study.md`](reference/case-study.md). The working surface is deliberately small: a writer boxed in by a long checklist produces compliance, not prose — that failure mode is the case study's best-documented finding. Draft with the principles below; diagnose with the catalog afterwards.

## Before you start

If the invocation carries no text and no assignment, ask for one: the draft to edit, or the topic, length, audience and language to write fresh. Settle two things early. The register: books, newspapers and encyclopedias are the default target, while marketing, speeches and reference documentation legitimately bend these rules, so confirm how far to go. And any hard length target: humanizing shrinks text, and gaps are filled with substance, never padding. If the genre needs material nobody has gathered — reportage needs a scene, a person, a quotation — say so and get it, or agree to relabel the piece; never fake the texture.

## Core principles

1. **No pattern twice.** Whatever the figure — a contrast frame, a triad, a cleft, an opener shape, a paragraph arc, a metaphor, even a favorite connective particle — its second consecutive use is a rhythm and its third is a stencil. Vary sentence length, clause weight, paragraph attack and closer; if every paragraph advances by the same move, swap engines somewhere.
2. **Density is anchored facts in whole grammar.** Names, dates, numbers, mechanisms and worked examples carry the argument; hype, era openers, phantom crowds ("faster than most expected" — who?) and concepts pushing concepts carry nothing. Compress by dropping padding, not grammar: subjects stay, first mentions get their full noun, and the event that matters gets a sentence of its own.
3. **Cap the quotables.** One or two turned phrases can carry a piece, counting every shape: chiasmus, mirrored re-description, balanced antithesis, aphoristic kickers. State the thesis once and develop it with new material or cut the echo. Most paragraphs end flat, and an argument survives a dud.
4. **A real writer, with the material.** Opinion owns its anecdotes and risks a judgment of its own; reportage has stood somewhere; reference registers keep the writer invisible without chaperoning the reader. Claims sized to the evidence, honest hedges kept, references anchored (who, where, when), and one non-obvious source beats a second canonical one.
5. **Structure serves content.** Open on ground, not on a cold verdict and not on an era; paragraphs develop one idea across several sentences; headings and bullets appear only where content is genuinely enumerable; the piece ends where the information ends.
6. **Write from inside the language.** Native idiom — a sentence that back-translates cleanly into another language was composed there, so recompose it — native punctuation at native frequency (a dash where the register expects one beats zero), and the venue's typography held consistently. Per-language budgets and surface forms: [`reference/language-cues.md`](reference/language-cues.md), which indexes one `reference/<lang>-cues.md` file per language.
7. **True, verified, calibrated.** Never invent specifics. Re-derive every mechanism example from the stated mechanism, split fused attributions, and verify or delete every superlative. One fluent falsehood outweighs any amount of style.

Over all seven: **aim for the natural distribution of edited prose, not a perfect scorecard.** Every rule above, overdriven, mints a new tell — the case study documents four such artifacts (banned openers became cold-open verdicts; scrubbed punctuation became semicolon inflation and rationed warmth; density became telegraph compression; scrubbed abstraction became contrived colloquialism). Keep some looseness, an aside, an unresolved edge.

## Method

1. **Read whole, list the keeps.** Facts, quotations, required terminology, genre constraints, any hard length target. Everything on the list survives the rewrite.
2. **Draft, or restructure, by the principles.** For an existing draft: merge fragment paragraphs by idea, delete scaffolding, then rewrite sentence by sentence. Do not draft against the catalog — that produces compliance-shaped text.
3. **Census.** Now open [`reference/tells.md`](reference/tells.md) and count. The drafting mind cannot see its own tics: in a field test, an author who felt two aphorisms was carrying eight, and five triads survived a no-triads rule. Mechanical counting over impression, catalog over memory; a flagged pattern kept for its quality is still flagged.
4. **Revise and gate.** Fix what the census found; verify facts and mechanisms (principle 7); read aloud for rhythm. Then the excerpt test: any paragraph alone should sit unnoticed in a book, a broadsheet or an encyclopedia. Finish with one skeptical-editor read asking where a reader would still mutter "AI wrote this" — and when several pieces come from one session, compare them side by side, because shared architecture across pieces is a fingerprint too. One more stop rule: a spot flagged again after repair is overloaded, not misworded — restructure the thought (split it, reorder it) instead of trying a third wording.

## Worked example (English)

Before, tells marked: "In today's rapidly evolving AI landscape [era opener], skills have emerged as a game-changer [hype]. A skill isn't just a document — [dash] it's a reusable playbook [template contrast] that transforms how agents work. Whether you're automating reports, reviewing code, or managing data [triad, reader address], skills unlock consistency, reliability, and scale [triad, hype]. The future of agent workflows starts here [uplift ending]."

After: "A skill is a document that tells an AI agent how to perform one kind of task. The agent keeps only the document's one-line summary in memory and reads the full text when a matching task arrives, so hundreds of skills can be installed at negligible cost. The format is plain Markdown with a short metadata header, which means anyone who can write instructions can write a skill."

The full tell catalog is in [`reference/tells.md`](reference/tells.md), per-language surface forms in the `reference/<lang>-cues.md` files indexed by [`reference/language-cues.md`](reference/language-cues.md), and the measured record behind all of it in [`reference/case-study.md`](reference/case-study.md).
