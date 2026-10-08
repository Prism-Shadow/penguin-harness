# Faster coding-agent discovery: each PATH folder is read once per scan

- **Date:** 2026-10-08
- **Type:** fix
- **Scope:** `coding-agents`

The Models page waited on a fresh coding-agent scan every time it loaded, and on Windows that scan took 0.5–0.9 seconds. It checked every agent command against every PATH folder and every PATHEXT extension one file at a time, so a long PATH meant tens of thousands of file checks, nearly all for agents that are not installed.

A scan now reads each folder's contents once and shares them across every agent it looks for. It only checks a file directly when the folder holds that name. The same machine now scans in 60–100 ms, with identical results. Sign-in states still show as soon as they change, because nothing is cached between scans.
