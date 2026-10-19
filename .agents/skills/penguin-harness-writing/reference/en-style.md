# English style

The voice and the banned list for English text: posts, docs pages and landing copy alike. What
differs by kind of text (shape, reader, how it ends) lives in the `profile-*.md` files.

The block between the `prompt` markers is sent to the model verbatim as `{{STYLE}}` /
`{{STYLE_TARGET}}` by `scripts/prose.mjs`. The check patterns after it are what
`prose.mjs check` greps for. Change the two together: a phrase banned in the prompt and missing
from the patterns slips through `check`, and a pattern with no line in the prompt fails drafts for
a rule the model was never given.

<!-- prompt -->
Voice: an engineer who builds what they write about, writing for developers: plain, direct and specific.

Shape:
- Short paragraphs, one idea each, at most four sentences. Vary sentence length; average under 20 words.
- Concrete over abstract: name the product, the file, the command, the number, and let it carry the point. An example beats an adjective.
- Figures carry part of the argument. Introduce each figure in the sentence before it, with the same nouns the figure's labels use, and do not describe in prose what the figure already shows.
- State our position as ours: "we think", "our bet is", "in PenguinHarness we chose". Attribute others' claims to them by name. Mark uncertainty plainly ("we do not know whether…").

Banned (do not use, do not paraphrase around):
- Marketing register: powerful, seamless, effortless, game-changer, next-level, revolutionary, unlock, empower, supercharge, leverage (verb), robust, transform/transformative, "the future of", "imagine a world", "say goodbye to", "in seconds, not", "meet your new".
- Essay tics: "it's not just X, it's Y" and every "not X but Y" pivot; "Here's the thing"; "Let's be honest"; "In today's fast-paced"; "delve"; "landscape"; "paradigm"; "journey"; "at the end of the day"; "In conclusion"; rhetorical questions as openers; sentences of three words in a row for effect; triads where two items would do.
- Punctuation: em dashes at most once per section, spaced ` — `; no exclamation marks; no bold on scattered words (bold only for UI labels and product names on first mention, if at all).
- Structure: no "Challenges and future outlook" section; no bullet list longer than five items; no list where a paragraph works.
- Theatre framing: never dismiss something as "X theater".

Lists are allowed where the content is a list (steps, named layers, a comparison). Tables are allowed for a side-by-side of up to four columns.
<!-- /prompt -->

## Check patterns

One per line: a backticked `/regex/flags`, then ` — ` and the label printed on a hit. Hits under
**Errors** fail `check`; hits under **Warnings** are printed for a person to judge. Code spans,
link targets and quoted text ("…", “…”) are masked before matching, so a quotation from a source
does not trip a rule. The structural rules (em dashes per section, exclamation marks, list length,
paragraph and sentence length, a question that opens a section) are counted in the script itself.

### Errors

- `/\bpowerful\b/i` — marketing register: powerful
- `/\bseamless(ly)?\b/i` — marketing register: seamless
- `/\beffortless(ly)?\b/i` — marketing register: effortless
- `/\bgame[- ]chang(er|ers|ing)\b/i` — marketing register: game-changer
- `/\bnext[- ]level\b/i` — marketing register: next-level
- `/\brevolution(ary|ize|ise|izes|ises|ized|ised)\b/i` — marketing register: revolutionary
- `/\bunlock(s|ed|ing)?\b/i` — marketing register: unlock
- `/\bempower(s|ed|ing|ment)?\b/i` — marketing register: empower
- `/\bsupercharg(e|es|ed|ing)\b/i` — marketing register: supercharge
- `/\bleverag(e|es|ed|ing)\b/i` — marketing register: leverage (verb)
- `/\brobust(ly|ness)?\b/i` — marketing register: robust
- `/\btransform(s|ed|ing|ative|ation|ational)?\b/i` — marketing register: transform/transformative
- `/\bthe future of\b/i` — marketing register: "the future of"
- `/\bimagine a world\b/i` — marketing register: "imagine a world"
- `/\bsay goodbye to\b/i` — marketing register: "say goodbye to"
- `/\bin seconds, not\b/i` — marketing register: "in seconds, not"
- `/\bmeet your new\b/i` — marketing register: "meet your new"
- `/\b(it'?s|it is|this is|that'?s|that is) not (just|only|merely|simply)\b/i` — essay tic: "it's not just X, it's Y"
- `/\bhere'?s the thing\b/i` — essay tic: "Here's the thing"
- `/\blet'?s be honest\b/i` — essay tic: "Let's be honest"
- `/\bin today'?s fast[- ]paced\b/i` — essay tic: "In today's fast-paced"
- `/\bdelv(e|es|ed|ing)\b/i` — essay tic: delve
- `/\blandscapes?\b/i` — essay tic: landscape
- `/\bparadigms?\b/i` — essay tic: paradigm
- `/\bjourneys?\b/i` — essay tic: journey
- `/\bat the end of the day\b/i` — essay tic: "at the end of the day"
- `/\bin conclusion\b/i` — essay tic: "In conclusion"
- `/\b[A-Za-z-]+ theat(er|re)\b/i` — theatre framing: "X theater"
- `/\bchallenges and (the )?future\b|\bfuture outlook\b/i` — structure: "Challenges and future outlook" section

### Warnings

- `/\bnot (just|only|merely)\b[^.;:!?]{1,80}\bbut\b/i` — possible "not X but Y" pivot
- `/\bnot\b[^.;:!?]{1,40}, but\b/i` — possible "not X, but Y" pivot
- `/\bnot [a-z]+ but [a-z]+\b/i` — possible "not X but Y" pivot
- `/\bwe can see that\b|\bit is worth noting\b|\bit'?s worth noting\b/i` — filler signpost
