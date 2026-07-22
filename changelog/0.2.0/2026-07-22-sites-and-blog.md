# Sites: one navbar, a richer blog, and the built-in Skills listed

## The docs and landing navbars are identical

The two sites' navbars differed in container width (6xl vs 7xl), the docs-only badge pill, hamburger placement and a broken menu animation class. Both now share the same `max-w-7xl` container (the landing footer aligned to match, framing nav and footer consistently while content sections stay 6xl), the same logo block, and the same right-cluster layout; the landing language menu's undefined `anim-pop` class was replaced with the working `anim-fade`. Cross-SPA link semantics and each site's mobile behavior stay as they were.

## Blog categories, pinned posts, and page metadata

The blog list stays a single flat list with category badges and filter chips, now across three categories — Product news, Release notes, and the new Tech practice, which the AMD local-agents post moved into. Posts can be pinned to the top via `pinned: true` frontmatter; the launch post introducing PenguinHarness is pinned. A second practice post joined the blog: implementing agent self-improvement with PenguinHarness on an AMD GPU (en + zh), adopted into the same category and author conventions. The detail page moves its metadata below the title: a locale-formatted date ("July 20, 2026" / "2026年7月20日"), the author line (frontmatter `author`, defaulting to Yaowei Zheng (PrismShadow AI)), and a copy-page-link button with a safe clipboard fallback and a transient "Copied" state.

## Three technical posts on harness design and agent infrastructure

The blog gains three bilingual Tech-practice posts, each sourced against primary material rather than summary:

- **Simple Harness Is All You Need** — builds on the Databricks coding-agent benchmark, where holding the model and reasoning effort fixed and swapping only the harness moved cost per task by more than 2× at unchanged quality, with the minimal Pi harness sending roughly a third of the context per turn. The post maps that result onto PenguinHarness's own measured design: six built-in tools with no file tools at all, a 72-line system prompt, a 16,000-character output cap, and compaction into a fresh context — then argues where minimalism must stop, since Pi ships no permission system while per-call approval and Trace auditing are load-bearing here.
- **The Easiest Way to Build AI Agents in 2026** — compares LangChain/LangGraph, CrewAI, the OpenAI Agents SDK, Google ADK and Dify against PenguinHarness on facts checked 2026-07-22 (versions, licenses, stars, minimum lines to a tool-using agent, and what ships in the box), documents the field's convergence on thin — AutoGen in maintenance mode, LangChain's legacy surface moved to `langchain-classic`, "harness" adopted as vendor vocabulary by AWS, Microsoft and Anthropic within two months — and includes a section on when not to use PenguinHarness.
- **AI Infrastructure: Past, Present, and Future** — argues that the AI development stack (PyTorch, vLLM, Ollama, LlamaFactory) was built for a human operator who carries state in their head, treats errors as a starting point for investigation, and reads documentation once. It needs no reinventing for agents, since it is already commands and config files; what was missing is the operating knowledge around it, which the shipped `ollama`, `vllm` and `llamafactory` skills encode — check before you change, preflight the constraint that actually binds, verify with an observation, and register the served model so the job is finished rather than started. Closes on what remains unsolved: ML-stack errors still written for humans, GPUs as a shared resource with no reservation protocol, and reproducibility.

The landing blog list test moves to the new post count and the practice-category ordering that follows from it.

## The built-in Skills, listed where people look

The READMEs (both languages) gain a compact Built-in Skills section — one table of the four skill groups and their members — and the landing page gains a matching Skills section of group cards between Features and Security. The lists cover what currently ships and grow as new skills land — refreshed in this release to include the vLLM/Ollama serving and LlamaFactory fine-tuning skills once they landed.
