# The domains' web features live in their library packages

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-11-24-library-web-halves.zh.md)

The agents, projects, traces and models domains' web features (the agents pages, the projects pages, the traces pages, the model pages and the model picker) moved from the web app into their domain packages. Each package serves its web half through a `./web` entry; the web app compiles that TypeScript source in directly and mounts the domain modules as its own children. The shared app pieces the features consume are re-exported through one internal surface of the web app. No behavior changes.
