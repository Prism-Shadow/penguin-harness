# READMEs

The repository READMEs (en/zh).

## Restructure the README around the product story

The README now leads with the agents-build-agents pitch and community links, then three
feature showcases (benchmark chart, one-sentence RAG demo, self-evolution), followed by
changelog/blog/docs, supported models, human-first installation, a roadmap, CONTRIBUTING,
a citation, and credits.

## Details

- New narrative header: "With LangChain, you build agents by hand — at 1x speed. With
  PenguinHarness, agents build agents — at 100x." with the subtitle "A zero-code CLI and
  Web UI, connected to 1000+ models," plus community links (Discord / X / WeChat).
- Feature 1 "Simple and Efficient": light/dark benchmark bar charts generated from the
  landing benchmark data (accuracy and cost per run vs Claude Code and OpenAI Codex, all
  driven by DeepSeek V4 Pro), committed as `assets/readme/benchmark-{light,dark}.svg`.
- Feature 2 "Build an Agent in One Sentence": the RAG one-sentence prompt plus a real
  product screenshot captured by the new `packages/landing/scripts/capture-readme-demo.mjs`
  (same real-server + mock-LLM pipeline as the landing shots), committed as
  `assets/readme/rag-demo-{light,dark}.webp`.
- Feature 3 "Self-Evolution": copy describing the evaluate-optimize-snapshot loop with an
  HTML-comment placeholder for the upcoming demo video.
- New sections: Changelog / Blog / Docs links, a supported-models table (DeepSeek V4,
  Kimi K3, GLM 5.2, Hunyuan 3, Qwen 3.8 Max, GPT 5.5, Gemini 3.5 Flash, Claude Opus 4.8
  with their providers, plus the 1000+-via-gateways note), Requirements and Installation
  split into "Web App — for humans" and "CLI & SDK — for agents", a Roadmap (benchmark
  suite release), a BibTeX citation ({PrismShadow Team}), and the license/credits footer.
- New `CONTRIBUTING.md` absorbs the developer content: dev commands, repo layout table,
  quality gates, the English-only and changelog working rules, and the README-asset
  regeneration notes; the README's Development section now points there.
- `README.zh.md` mirrors the new structure in Chinese.

## Refresh the README model table against the current catalog

The supported-models table (the same eight models) becomes two columns — model on the
left, the comma-separated providers it's available from on the right (per today's catalog)
— and the note below now names all five OpenAI-compatible gateways.

## Details

- Availability per the catalog: DeepSeek V4 in five groups, GLM 5.2 in six, Kimi K3 via
  OpenRouter and Qwen Pay-As-You-Go, Qwen 3.8 Max as the Token Plan preview, GPT 5.5 and
  Claude Opus 4.8 native + OpenRouter, Hunyuan 3 via OpenRouter, Gemini 3.5 Flash native.
- The gateway note lists OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan, and
  Qwen Pay-As-You-Go. README.zh.md mirrors.

## Split badge rows and showcase the finished RAG app

The site badges (Website / Docs / Blog) and the community badges (Discord / X / WeChat) now sit on separate lines. The one-sentence example becomes the condensed claude-code-docs configuration-expert prompt (the chat page's example task carries the full version), and the demo image shows the FINISHED PRODUCT — the generated docs-expert app with cited clickable sources and example questions (`assets/readme/rag-app-<lang>-<theme>.webp`, per-language shots; the zh README shows the Chinese prompt and shots) — instead of the PenguinHarness chat UI. The mockup renderer (`rag-app-mockup.html` + rewritten `capture-readme-demo.mjs`, no server needed) comes along so the assets stay regenerable.
