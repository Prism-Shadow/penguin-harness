---
name: humanizer
description: Rewrite or edit prose in any language so it reads like edited human writing in the register of books, newspapers and encyclopedias rather than default AI output: remove template contrasts (not X but Y), rhetorical triads, dash overuse, decorative metaphors, one-sentence paragraphs, signposting, hype vocabulary and uplift endings, then restore information density and varied sentence rhythm; the rules are language-universal with English and Chinese cues, distilled from a measured before-and-after case study.
short_description: Strip AI-writing tells from prose in any language.
short_description_zh: 去除文本的 AI 味，把行文改成书籍、报纸、百科式的风格，任何语言通用。
preinstall: false
version: 1
updated: 2026-08-11T00:00:00Z
---

# Humanizer

Make prose read like edited human writing: the register of books, quality newspapers and encyclopedia entries. The rules below come from a controlled exercise in which one assignment was answered twice, first as a deliberately typical AI draft and then rewritten into print register, with the tells counted mechanically in both; the full exercise is in [`reference/case-study.md`](reference/case-study.md). The tells are structural rather than lexical, so the same rules apply to Chinese, English and other languages. Per-language cues are given where surface forms differ; for a language not listed, map the structural pattern to its local surface form and keep that language's own punctuation norms.

## Before you start

If the invocation carries no text and no assignment, ask for one: either the draft to edit, or the topic, length, audience and language to write fresh. Two things are worth settling early:

- **Register.** Books, newspapers and encyclopedias are the default target. If the text is marketing copy, a speech, a chat reply or reference documentation, confirm how far to go, because some patterns below are legitimate in those genres.
- **Hard length target.** Humanizing shrinks text (the case study lost 17% of its characters while gaining facts). If a fixed length is required, plan to fill the gap with substance, never padding.

## What gives AI text away

Default AI prose is uniform and ornamental where print prose is dense and plain. The signature is structural: every sentence near the same length, every idea dressed in a symmetric template, structure announced instead of enacted, decoration substituted for information. Because the signature is structural, it survives translation, and so do the fixes. Fix structure first; vocabulary last.

## The tells

For each: what to look for, then the fix.

1. **Template contrasts.** The correction-shaped sentence recurs: "not X, but Y", "It's not just X, it's Y" (en); 不是……而是……、这不仅是……更是…… (zh). One per piece can be earned; several is a signature. Fix: state Y directly and let X go unmentioned, or concede X in a plain subordinate clause.
2. **Rhetorical triads.** Three parallel adjectives, three parallel clauses, three bullet virtues, whole sections in threes ("faster, safer, smarter"; 高效、可靠、优雅). Enumerating three real items is fine; manufacturing a rhythm of threes is the tell. Fix: keep the true items and break the symmetry: two items, four, or one item expanded with a fact.
3. **Dash overuse.** Em-dash asides every few sentences (en); 破折号 doing the work of commas and colons (zh). Print prose spends dashes rarely. Fix: a comma, a colon, parentheses, or a full stop and a new sentence. More than about one dash per several hundred words is a tell; zero is normal.
4. **Decorative metaphors.** Figures that add mood, not meaning: "a digital symphony", "unlock the magic"; 像一位不知疲倦的助手、知识的魔力. Test a figure by asking what it lets the reader compute; if nothing, cut it. An analogy that compresses a mechanism may stay, at most one per piece; the case study ended up keeping none.
5. **Paragraph fragmentation.** Many one- and two-sentence paragraphs, dramatic single-line paragraphs for applause. Print paragraphs develop one idea across several sentences: claim, development, evidence or example. Fix: merge fragments by idea, then delete the connective padding the merge exposes.
6. **Signposting and scaffolding.** "First/Second/Finally", "In conclusion", "Let's dive in", "It's worth noting" (en); 首先/其次/最后、总而言之、值得注意的是 (zh); subheadings, numbered sections and bold labels in a piece short enough to carry itself; meta-commentary about the text ("this article will..."; 本文将……、今天我们就带你搞懂). Fix: delete the signpost and make the order do the work; in a piece under roughly a thousand words, prefer no subheads at all.
7. **Hype and vagueness.** Empty intensifiers ("crucial", "transformative", "revolutionize"; 至关重要、深刻改变、飞速发展), era openers ("In today's fast-paced world..."; 在人工智能飞速发展的今天……), unverifiable attributions ("studies show", "experts believe"; 研究表明、有人认为), uplift endings ("The future is bright"; 未来已来). Fix: replace with named actors, dates, numbers and mechanisms drawn from the source or the user; if no specific exists, make the plain claim without amplification, and end the piece on its last substantive point.
8. **Uniform rhythm.** Sentences clustering around one length, balanced two-part clauses (对仗) sentence after sentence, every paragraph the same size. Fix: vary deliberately; follow a long qualified sentence with a short flat one. Read the passage aloud; if nothing swings, it drones.
9. **Reader management.** Second-person coaching ("you might wonder", "imagine..."; 想象一下、你可能会问), rhetorical questions as transitions, cheerleading interjections. Encyclopedic and newspaper register describes; it does not chaperone. Fix: convert questions to statements and move the reader out of the sentence; keep second person only where the genre demands instructions.
10. **Rotation and quoting.** Synonym rotation for one referent ("the tool", "the platform", "the solution" all meaning one product; 技能包、手册、本领 for the same thing) and scare quotes on ordinary words. Print register repeats the exact term, and reserves quotation marks for coined terms at first mention and for real quotations. Fix: one term per referent; strip the other quotes.

## Target register

What the destination looks like, stated positively:

- Every sentence adds a fact, a qualification or a consequence; no sentence restates the previous one in brighter clothes.
- Paragraphs run several sentences and develop exactly one idea each.
- Concrete detail carries the argument: names, dates, numbers, mechanisms, worked examples. Abstraction appears only to organize concretes.
- The writer is invisible: no enthusiasm about the topic, no narration of the writing, no applause lines.
- Headings, bullets and tables appear only when content is genuinely enumerable or the genre requires them; otherwise prose.
- The piece ends where the information ends.

## Method

1. **Read whole, list the keeps.** Facts, quotes, required terminology, genre constraints, any hard length target. Everything on this list must survive the rewrite.
2. **Census.** Count the tells before editing: dashes, contrast templates, triads, paragraphs of two sentences or fewer, hype words, scare quotes, reader addresses, subheads. Counting beats impression, and the numbers show where the rewrite effort should go.
3. **Restructure first.** Merge fragment paragraphs by idea, delete scaffolding sections, drop subheads a short piece does not need. Structural edits remove more AI flavor than any amount of word swapping.
4. **Sentence pass.** Apply tells 1 through 10 line by line.
5. **Density pass.** The rewrite is now shorter. If there is a length target, fill the gap with substance: origin, mechanism, comparison, a worked example, a limitation. Never refill with rhetoric.
6. **Rhythm read.** Read the result aloud, vary sentence length where it drones, and check that each paragraph opens with matter rather than throat-clearing.
7. **Gate.** Re-run the census; the target is zero on every counter, or a deliberate exception you can name. Then the excerpt test: take any paragraph alone, and ask whether it could sit unnoticed in a book, a broadsheet or an encyclopedia. If not, it is not done.

## Do not overcorrect

- **Never invent specifics.** Tell 7 replaces hype with facts taken from the source or the user. If a needed fact is missing, ask for it or keep the claim plain; a fabricated number is worse than a vague one.
- **Do not fake a human.** No inserted typos, slang, opinions or anecdotes the source does not contain. The target is edited prose, not an impersonation of casual typing.
- **Respect genre exceptions.** Reference documentation and checklists legitimately use headings, bullets and repeated structure, as this document does. Marketing copy and speeches tolerate more rhetoric. Confirm scope with the user rather than flattening those genres silently.
- **Preserve meaning exactly.** Same claims, same hedges, same attributions, same language as the source. Humanizing is a register change, not a content edit.

## Worked example (English)

Before, tells marked: "In today's rapidly evolving AI landscape [era opener], skills have emerged as a game-changer [hype]. A skill isn't just a document — [dash] it's a reusable playbook [template contrast] that transforms how agents work. Whether you're automating reports, reviewing code, or managing data [triad, reader address], skills unlock consistency, reliability, and scale [triad, hype]. The future of agent workflows starts here [uplift ending]."

After: "A skill is a document that tells an AI agent how to perform one kind of task. The agent keeps only the document's one-line summary in memory and reads the full text when a matching task arrives, so hundreds of skills can be installed at negligible cost. The format is plain Markdown with a short metadata header, which means anyone who can write instructions can write a skill."

The full Chinese exercise, both texts and the measured census, is in [`reference/case-study.md`](reference/case-study.md).
