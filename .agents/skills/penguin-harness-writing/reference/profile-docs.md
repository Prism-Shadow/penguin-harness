# Profile: docs pages

Loaded for `--profile docs`: a page of `packages/docs/content/<slug>.<en|zh>.md`. The `prompt`
block is sent to the model as `{{PROFILE}}` after the style guide; `## Check settings` is read by
`prose.mjs check` and never sent. TERMS for a docs page carries the UI labels exactly as the
product's dictionaries spell them (`packages/web/src/lib/strings-en.ts` and `strings.ts`, the
shared `ui-strings.ts`), one row per label with its en and zh form.

<!-- prompt -->
A docs page helps a reader get one kind of task done in the product, in the manner of Obsidian Help: task-first, exact, short.
- The reader arrives with a task. Open with what the page covers in one or two sentences, then go straight to the tasks; a short list of links to the common tasks may follow the opening.
- One task per section, named by what the reader does ("Send a message") or by the thing it describes ("Limits"). Steps are numbered, one action each, and say where to act before what to select.
- UI labels are copied exactly as TERMS gives them for this language, in bold. Never paraphrase or translate a label yourself.
- State what the product does, its defaults and its limits. No opinions, no "we think", no marketing, no history of how a feature came to be.
- Second person and present tense. Exceptions and caveats go after the steps they qualify, as a "Good to know" list or a callout.
- The page exists in English and Chinese with the same sections in the same order.
- Keep it short: at most 500 words in all, an opening of at most 60 and sections of at most 120; link another page instead of repeating it.
<!-- /prompt -->

## Check settings

- lead: yes
- words: 1-500
- lead-words: 1-60
- section-words: 1-120
- zh-chars: 1-1200
- zh-lead-chars: 1-150
- zh-section-chars: 1-300
- ui-labels: bold
