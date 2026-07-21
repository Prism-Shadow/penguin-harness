# One-shot RAG app flow: skills rewrite and a draft-screen example task

PR #11's squash — briefly lost to a force-push race during the branch rebase — is restored: the skills library rewrite that makes one-sentence RAG apps one-shot, a draft-screen example task card, and the finished-product showcase pipeline.

- penguin-sdk rewritten around a complete RAG recipe (corpus collection, heading chunking, local BM25 retrieval, per-request Session SSE answers with citations, run-and-verify checklist); web-design gains the Penguin visual language and chat/RAG layout recipes; agent-creation covers skill bundles; agenthub-dev retires and a firecrawl skill joins.
- The Web draft screen gains example task cards (full prompts submitted as-is), with chat stream rendering refinements (markdown module, work summaries, stream follow) and colorful skill icons.
- The landing capture pipeline drives the docs-expert conversation and renders the finished-app mockup; README/Cases assets and prompts match the earlier finished-product switch.
