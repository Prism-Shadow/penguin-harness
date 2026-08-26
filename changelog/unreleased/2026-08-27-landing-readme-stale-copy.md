# Landing site and README corrected where the copy had stopped being true

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `landing`, `docs`, `skills`
- **PR:** [#481](https://github.com/Prism-Shadow/penguin-harness/pull/481)

[中文版](2026-08-27-landing-readme-stale-copy.zh.md)

Swept the landing site's two string dictionaries and both root READMEs for claims that no longer held, and corrected them in English and Chinese together.

## Details

- **The download page's first-launch FAQ dropped its macOS and Windows items.** It told visitors that builds were unsigned and walked them through deleting the macOS quarantine flag with `sudo xattr -rd` and clicking past Windows SmartScreen. The macOS builds have been Developer ID signed and notarized since 0.2.2 and the Windows installers Authenticode signed since 0.2.4, so neither instruction applied. The intro now states the signing, and the Linux AppImage execute bit — the one first-launch fix that is still real — is the only item left. `MAC_UNQUARANTINE_CMD` went with the item it fed.
- **The same two `<details>` blocks and the "current builds are unsigned" line were removed from `README.md` and `README.zh.md`,** leaving the Linux AppImage block.
- **The built-in Skill lists gained the five Skills that had joined the library since they were written** — `bento-slides` and `humanizer` under Office Productivity, `remote-claude-code` under Software Development, and `penguin-orchestration` and `skill-porting` under AI App Development. Applied to the landing page's Skills section and to both READMEs' tables, in the order the Skills documentation lists them.
- **The Skill lists are now pinned to the shipped library.** `packages/landing/test/skills-sync.test.ts` asserts that each dictionary's Skills section names exactly the directories under `packages/skills/skills/`, and `packages/skills/test/skills.test.ts` extended its existing README guard to cover the two root READMEs alongside the package's own. Both compare membership rather than order, and name the offending Skill in the failure.
- **The READMEs' supported-model table was re-derived from `packages/core/src/state/model-catalog.ts`.** The table promises each family's latest generation only, so `GLM 5.2` became `GLM 5.3` and `Gemini 3.6 Flash` became `Gemini 3.7 Flash`; `GPT 5.6` gained the direct OpenAI group beside OpenRouter; and the TokenDance group was added to the DeepSeek V4, Kimi K3, GLM and Qwen 3.8 Max rows, with Fireworks AI added to Kimi K3.
- **The feature section's subtitle stopped claiming a one-to-one mapping onto the Web App's menu.** The standalone Trajectories page is gone — a Trace is read in its conversation's panel — and the grid lists capabilities that were never menu entries. It now says the capabilities are in the web interface, which is what the grid shows.
