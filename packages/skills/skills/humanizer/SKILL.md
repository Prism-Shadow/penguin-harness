---
name: humanizer
description: Rewrite or edit prose in any language so it reads like edited human writing in the register of books, newspapers and encyclopedias rather than default AI output: a sentence layer (template contrasts, rhetorical triads, dash overuse, decorative metaphors, one-sentence paragraphs, signposting, hype, uniform rhythm, reader management, synonym rotation) plus a discourse layer (cold-open verdicts, sentence-skeleton runs, one-aphorism-per-paragraph cadence, thesis restatement, abstraction chains, overclaimed conclusions, imported idiom), with English and Chinese cues, a census-driven method, and a measured two-round case study.
short_description: Strip AI-writing tells from prose in any language.
short_description_zh: 去除文本的 AI 味，把行文改成书籍、报纸、百科式的风格，任何语言通用。
preinstall: false
version: 2
updated: 2026-08-11T00:00:00Z
---

# Humanizer

Make prose read like edited human writing: the register of books, quality newspapers and encyclopedia entries. The rules come from two rounds of evidence: a controlled exercise in which one assignment was answered twice, first as a deliberately typical AI draft and then rewritten into print register, with the tells counted mechanically in both; and field tests in which text written to those first rules was still flagged by human readers, which yielded the discourse layer. Both rounds are documented in [`reference/case-study.md`](reference/case-study.md). The tells sit in two layers, countable sentence-level patterns (1–10) and discourse-level shapes read for structure (11–17); they are structural rather than lexical, so the same rules apply to Chinese, English and other languages. Per-language cues are given where surface forms differ; for a language not listed, map the structural pattern to its local surface form and keep that language's own punctuation norms.

## Before you start

If the invocation carries no text and no assignment, ask for one: either the draft to edit, or the topic, length, audience and language to write fresh. Two things are worth settling early:

- **Register.** Books, newspapers and encyclopedias are the default target. If the text is marketing copy, a speech, a chat reply or reference documentation, confirm how far to go, because some patterns below are legitimate in those genres.
- **Hard length target.** Humanizing shrinks text (the case study lost 17% of its characters while gaining facts). If a fixed length is required, plan to fill the gap with substance, never padding.

## What gives AI text away

Default AI prose is uniform and ornamental where print prose is dense and plain. The signature is structural: every sentence near the same length, every idea dressed in a symmetric template, structure announced instead of enacted, decoration substituted for information. Because the signature is structural, it survives translation, and so do the fixes. Fix structure first; vocabulary last.

## The tells: sentence layer

For each: what to look for, then the fix. These are countable, and the census in the method below runs on them.

1. **Template contrasts.** The correction-shaped sentence recurs: "not X, but Y", "It's not just X, it's Y" (en); 不是……而是……、这不仅是……更是…… (zh). One per piece can be earned; several is a signature. Fix: state Y directly and let X go unmentioned, or concede X in a plain subordinate clause.
2. **Rhetorical triads.** Three parallel adjectives, three parallel clauses, three bullet virtues, whole sections in threes ("faster, safer, smarter"; 高效、可靠、优雅). Enumerating three real items is fine; manufacturing a rhythm of threes is the tell. Fix: keep the true items and break the symmetry: two items, four, or one item expanded with a fact.
3. **Dash overuse.** Em-dash asides every few sentences (en); 破折号 doing the work of commas and colons (zh). Print prose spends dashes rarely. Fix: a comma, a colon, parentheses, or a full stop and a new sentence. More than about one dash per several hundred words is a tell; zero is normal.
4. **Decorative metaphors.** Figures that add mood, not meaning: "a digital symphony", "unlock the magic"; 像一位不知疲倦的助手、知识的魔力. Test a figure by asking what it lets the reader compute; if nothing, cut it. An analogy that compresses a mechanism may stay, at most one per piece; the case study ended up keeping none.
5. **Paragraph fragmentation.** Many one- and two-sentence paragraphs, dramatic single-line paragraphs for applause. Print paragraphs develop one idea across several sentences: claim, development, evidence or example. Fix: merge fragments by idea, then delete the connective padding the merge exposes.
6. **Signposting and scaffolding.** "First/Second/Finally", "In conclusion", "Let's dive in", "It's worth noting" (en); 首先/其次/最后、总而言之、值得注意的是 (zh); subheadings, numbered sections and bold labels in a piece short enough to carry itself; meta-commentary about the text ("this article will..."; 本文将……、今天我们就带你搞懂). Fix: delete the signpost and make the order do the work; in a piece under roughly a thousand words, prefer no subheads at all.
7. **Hype and vagueness.** Empty intensifiers ("crucial", "transformative", "revolutionize"; 至关重要、深刻改变、飞速发展), era openers ("In today's fast-paced world..."; 在人工智能飞速发展的今天……), unverifiable attributions ("studies show", "experts believe"; 研究表明、有人认为), unanchored references ("the author", "he recalls"; 作者认为、据他回忆 with no name, date or source, which reads as a second-hand digest), bare proper nouns dropped without a gloss, uplift endings ("The future is bright"; 未来已来). Fix: replace with named actors, dates, numbers and mechanisms drawn from the source or the user; anchor every reference (who, where, when) or drop it, and gloss a proper noun at first use; if no specific exists, make the plain claim without amplification, and end the piece on its last substantive point.
8. **Uniform rhythm.** Sentences clustering around one length, balanced two-part clauses (对仗) sentence after sentence, every paragraph the same size. Uniformity at any length counts: a drone of medium sentences, or a staccato run of clipped clauses (就要维护 M×N 套接口；接口一旦变动，各端的代码都要跟着改). Fix: vary deliberately, in both directions; follow a long qualified sentence with a short flat one, and let a clipped chain relax into one sentence with subordination. Read the passage aloud; if nothing swings, it drones.
9. **Reader management.** Second-person coaching ("you might wonder", "imagine..."; 想象一下、你可能会问), rhetorical questions as transitions, cheerleading interjections. Encyclopedic and newspaper register describes; it does not chaperone. Fix: convert questions to statements and move the reader out of the sentence; keep second person only where the genre demands instructions.
10. **Rotation and quoting.** Synonym rotation for one referent ("the tool", "the platform", "the solution" all meaning one product; 技能包、手册、本领 for the same thing) and scare quotes on ordinary words. Print register repeats the exact term, and reserves quotation marks for coined terms at first mention and for real quotations. Fix: one term per referent; strip the other quotes.

## The tells: discourse layer

A piece can score zero on every counter above and still read as AI. In field tests, text written to the sentence-layer rules was flagged by readers for the patterns below. They live in the shape of the opening, of adjacent sentences, of paragraphs and of the argument, and they surface only when you read for structure rather than wording.

11. **Cold-open verdict.** The first sentence is a categorical pronouncement, often colon-hinged: "LLMs only generate text: they cannot query a database or drive software."; 大模型本身只会生成文本：查不了数据库，调不动软件。 as an opening line. This is what overshooting the era-opener rule (tell 7) produces: all throat-clearing deleted, and with it the beat of ground a reader expects. Fix: open on the situation the piece answers (a problem, a dated event, an observable fact) and let the verdict land after it; one grounding sentence is orientation, not filler.
12. **Sentence-skeleton runs.** Adjacent sentences reuse one syntactic template: "Write one server, and every compatible app can call it; add support, and every existing server plugs in. Access, permissions and transport are already specified, so no pairing needs custom work."; 工具方写一个…，所有…都能…；应用方支持…，就能…。…都在…有统一约定，不再…。 Each sentence is fine alone; three on one skeleton is a stencil, and readers feel the fatigue before they can name it. Fix: rebuild one sentence in the run on a different frame: lead with the condition, expand one item into a clause with its own verb, or swap an abstract half for a concrete instance.
13. **One paragraph template, one aphorism each.** Every paragraph runs claim, explanation, widened conclusion, and peaks in a quotable line ("The model raises the ceiling; the harness decides how much of it is realized."; 模型的能力抬高的是上限，兑现多少取决于 harness). One or two aphorisms can carry a piece; one per paragraph is a metronome, and the reader stops trusting them. Fix: choose the one or two worth keeping, flatten the rest into plain statements, and let some paragraphs end on a fact, a number or an open question instead of a landing.
14. **Restatement dressed as development.** The central thesis reappears every few paragraphs in fresh abstractions (the ceiling line, the weights-are-only-the-start line, the shrinking-share line: one claim in three coats). This is how models expand thin material, and reviewers count it fast. Real development adds matter: a mechanism, a case, a number, a counterexample, a limit. Fix: state the thesis once; for every later echo, attach genuinely new material or cut it. Expect to cut 20–30% of an affected draft.
15. **Abstraction chains.** Sentences whose subject and object are both concepts, gliding on stock commentary phrases ("the invisible structure around the model", "each expansion absorbs what sat outside it"; 看不见的结构、边界外移、吸纳进来、……的来源). Individually plausible, together weightless: concepts push concepts and nothing observable happens. Fix: ground every second abstraction in a mechanism a practitioner could point to (when context is compacted, how a failed call is retried, where long-task progress is saved, how work is handed over). If the piece cannot supply that detail, the problem is missing material, not wording.
16. **Overclaimed conclusions.** Absolutes hung on thin evidence: "this proves", "no precedent existed"; 这说明……、并不存在、无法……. One case shows, at most, that something is possible. Fix: calibrate the claim to the evidence (这至少说明……、至少在当时……), and leave honest uncertainty standing; a text with no unresolved edge reads machine-finished. When editing someone else's text, calibration changes claim strength, so flag these edits instead of making them silently.
17. **Imported idiom.** Phrasing calqued from another language: 模型本身所占的比重不断缩小 tracks the English "the model becomes a smaller part of the system" word for word. Test: back-translate the sentence into English; if it gains fluency, it was composed in English patterns. Fix: recast in the target language's own idiom (随着任务变复杂，模型本身只是成败因素之一). The cue here is Chinese, but the rule is general: write each language from inside its idiom, not through another language's sentence frames.

## Target register

What the destination looks like, stated positively:

- Every sentence adds a fact, a qualification or a consequence; no sentence restates the previous one in brighter clothes.
- Paragraphs run several sentences and develop exactly one idea each.
- Concrete detail carries the argument: names, dates, numbers, mechanisms, worked examples. Abstraction appears only to organize concretes.
- The writer is invisible: no enthusiasm about the topic, no narration of the writing, no applause lines.
- Headings, bullets and tables appear only when content is genuinely enumerable or the genre requires them; otherwise prose.
- An argument advances by adding material: a mechanism, a case, a number, a counterexample. Restating the thesis in fresh abstractions is repetition, not development.
- At most one or two quotable lines per piece; most paragraphs end on matter, not on a landing.
- The piece ends where the information ends.

## Method

1. **Read whole, list the keeps.** Facts, quotes, required terminology, genre constraints, any hard length target. Everything on this list must survive the rewrite.
2. **Census.** Count the tells before editing: dashes, contrast templates, triads, paragraphs of two sentences or fewer, hype words, scare quotes, reader addresses, subheads; then the discourse counters: restatements of the central thesis, aphorism-cadence closers, sentences with a concept as subject, absolutes, adjacent sentences sharing one skeleton, and (outside English) calques that back-translate cleanly. Counting beats impression, and the numbers show where the rewrite effort should go.
3. **Restructure first.** Merge fragment paragraphs by idea, delete scaffolding sections, drop subheads a short piece does not need. Structural edits remove more AI flavor than any amount of word swapping.
4. **Sentence pass.** Apply the sentence-layer tells (1–10) line by line.
5. **Shape pass.** Outline each paragraph's moves in a few words (claim, why, bigger claim). Rebuild outlines that repeat, then apply the discourse-layer tells (11–17): reorder the opening onto ground, break skeleton runs, enforce the aphorism quota, cut thesis restatements, ground abstraction chains, calibrate overclaims, re-idiom calques.
6. **Density pass.** The rewrite is now shorter. If there is a length target, fill the gap with substance: origin, mechanism, comparison, a worked example, a limitation. Never refill with rhetoric.
7. **Rhythm read.** Read the result aloud, vary sentence length where it drones, and check that each paragraph opens with matter rather than throat-clearing.
8. **Gate.** Re-run the census; the target is zero on every counter, or a deliberate exception you can name. Then the excerpt test: take any paragraph alone, and ask whether it could sit unnoticed in a book, a broadsheet or an encyclopedia. Finally read once as a skeptical editor asking where a reader would still mutter "AI wrote this"; what that read catches is almost always discourse-layer.

## Do not overcorrect

- **Never invent specifics.** Tell 7 replaces hype with facts taken from the source or the user. If a needed fact is missing, ask for it or keep the claim plain; a fabricated number is worse than a vague one.
- **Do not fake a human.** No inserted typos, slang, opinions or anecdotes the source does not contain. The target is edited prose, not an impersonation of casual typing.
- **Respect genre exceptions.** Reference documentation and checklists legitimately use headings, bullets and repeated structure, as this document does. Marketing copy and speeches tolerate more rhetoric. Confirm scope with the user rather than flattening those genres silently.
- **Keep one beat of ground.** Tell 6 kills throat-clearing and tell 7 kills era openers; overshooting them produces the cold-open verdict of tell 11. One sentence of situation before the thesis is orientation, not filler.
- **Calibrate, do not litter hedges.** Fixing overclaims (tell 16) means matching claim strength to evidence, not weakening every sentence; a text that hedges everything is as machine-finished as one that hedges nothing.
- **Preserve meaning exactly.** Same claims, same hedges, same attributions, same language as the source; the one sanctioned strength change is the flagged overclaim calibration of tell 16. Humanizing is a register change, not a content edit.

## Worked example (English)

Before, tells marked: "In today's rapidly evolving AI landscape [era opener], skills have emerged as a game-changer [hype]. A skill isn't just a document — [dash] it's a reusable playbook [template contrast] that transforms how agents work. Whether you're automating reports, reviewing code, or managing data [triad, reader address], skills unlock consistency, reliability, and scale [triad, hype]. The future of agent workflows starts here [uplift ending]."

After: "A skill is a document that tells an AI agent how to perform one kind of task. The agent keeps only the document's one-line summary in memory and reads the full text when a matching task arrives, so hundreds of skills can be installed at negligible cost. The format is plain Markdown with a short metadata header, which means anyone who can write instructions can write a skill."

The full Chinese exercise, both texts and the measured census, is in [`reference/case-study.md`](reference/case-study.md).
