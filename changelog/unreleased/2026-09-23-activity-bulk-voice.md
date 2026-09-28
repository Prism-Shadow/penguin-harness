# Choose the voice for bulk narration

- **Date:** 2026-09-23
- **Type:** feat
- **Scope:** `web`

Speech coverage now has a voice picker when the speech provider offers more than one
voice. Generating every missing narration, trying a failed one again, and running the
stages all speak with the chosen voice, instead of always the provider's first.
