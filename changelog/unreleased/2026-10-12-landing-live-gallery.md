# The landing page shows the Web App live, and its navigation lists pages only

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `landing`, `docs`, `gallery`
- **PR:** [#1076](https://github.com/Prism-Shadow/penguin-harness/pull/1076)

[中文版](2026-10-12-landing-live-gallery.zh.md)

The landing home page was rebuilt around the real Web App, framed live from the component gallery, and the landing and docs navbars now list only standalone pages.

## Navigation

- The landing and docs navbars list Home, Blog, Download, Docs and Gallery, in one row from the `md` breakpoint up. The section anchors (Highlights, Quick start, Scenarios, Benchmark, CONTRACT.md, Features) and the scroll tracking that marked them were removed, and the footer dropped its links to removed sections.

## Home page

- New order: the hero, three showcase rows, the self-evolution loop with its demo, the one-request case, what PenguinHarness is made of, what is already built around the agent, the cost comparison, customer scenarios, latest updates, quick start, the call to action and the community links. The CONTRACT.md, Features, Skills and Security sections were removed with their copy, media and tests.
- The three animated graphics of the old page stay, restyled to the new page and rewritten: the self-evolution loop (Optimizer, Evaluator subagents, the tested agent's version N to N+1, three illustrative trend charts), the radiating diagram (now OmniMessage, Penguin SDK and Agent State) and the construction animation (an agent library against what PenguinHarness already ships, without the LangChain name or the 1x/100x multiplier). Reduced motion stops all three.
- New demo recordings, one per language, from the community repository: a decision agent's self-evolution under the loop (84 to 100 on the same model; six test-agent runs, $0.0373), and a legal app built from one request in the Cases section (five sample reviews, $0.0423), which replaces the RAG app. Each poster is the recording's own title frame; the RAG posters were deleted.
- The hero sets "for free" as a brand-coloured superscript on the corner of the positioning line, keeps three stat tiles (the model-count tile went), and leads each catalogue row with its count in the brand accent: 1000+ supported models from the dictionaries, the algorithm and Benchmark counts from `RSI_TOOLKITS` and `BENCHMARKS`. The Web App's start page follows, live.
- Three rows alternate a live frame with a title, one sentence and a docs link: a self-evolution round in a conversation, a Benchmark's score line in the Evaluation Center, and the RSI toolkits in the plugin market.
- Latest updates shows the four newest news and practice posts of the blog index, by date, and links to all posts.
- The copy in both dictionaries was rewritten, and the home page's sections dropped their eyebrows. The images and scripts nothing referenced any more were deleted.

## Live frames

- `LiveAppFrame` frames the gallery's frame document (`/gallery/app.html`) on one of the gallery's surfaces, in the app's default theme and the site's language and mode; the URL builder, the window sizes and the routes are imported from `packages/ui-gallery`. A frame loads near the viewport, shows a flat placeholder until it reports ready, and is pointed at a new document when the language or the mode changes.
- Frames are embedded (`embed=1`): until the reader clicks in, the framed app takes no focus, does not scroll the page and passes the wheel to it.
- Below `sm` a frame shows the gallery's phone window. Without a fine pointer it is a picture only, and its window bar links to the same surface in the gallery.
- In `dev`, the landing server passes `/gallery/` through to the gallery's dev server run with `BASE_PATH=/gallery/`, as the package README describes.

## Gallery

- New surface `chat-rsi`: the Project's built-in General Agent improves the docs Agent with the `agent-optimization` Skill — the Reference score, the weakest case's Trace, a snapshot, one `AGENTS.md` rule, four parallel `agent-evaluation` subagents, the accepted v15 and its scoreboard entry — in both languages, with the evaluators' and the Test Sessions' own histories.
- The demo Benchmark's evaluations climb across versions and end at the round's accepted version, which is the docs Agent's version, with the added rule in its `AGENTS.md`.
- The mock plugin library lists the RSI toolkits under Agent Self-Evolution and Agent Evaluation under AI App Development, from the shipped packages' own manifests and icons. Every built-in Benchmark comes from core's data, through a new core build entry, `state/builtin-benchmarks-data`.
- The New chat surface opens the draft route `/chat/new`; a bare `/chat` opened the newest conversation instead.
- An embedded frame (`embed=1`) drops focus calls and outward `scrollIntoView`, and forwards the wheel to the page, until its document has focus.
