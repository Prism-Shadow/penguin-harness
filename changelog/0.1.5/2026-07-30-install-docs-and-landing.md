# Install documentation and landing refresh for 0.1.5

The 0.1.5 release repackages how the product introduces and installs itself, in both READMEs and on the landing site.

## One tagline pair everywhere

README and landing unify on the same two lines: **"Your Automated Agent Builder, Right on Your Desktop / Server"** (the landing hero keeps rotating the Desktop/Server word; the README writes the pair with a slash) and the subtitle **"Create Self-Evolving Agents in One Click"** — 中文为「全自动 Agent 构建平台，运行在你的桌面 / 服务器上」与「一键创建自进化 Agent」. The hero's "Agents building agents" badge is removed; the phrase moves to the LangChain comparison section, retitled **"Building Agents with Agents"** (用 Agent 构建 Agent).

## README: every install method spelled out

The Installation section now gives each method its own complete, copy-paste code block — Linux, macOS and Windows online one-liners, npm — each ending in `penguin web`, with the five offline bundles documented per-OS inside a collapsible `<details>` block (extract-and-run commands, architecture hints, the unconditional SHA256 note). The Web-App feature pitch folds into the section intro; the CLI & SDK section is unchanged.

## Landing: switch, don't list

- The hero's install box and the quick start's install step both switch by OS (Linux / macOS / Windows) instead of stacking every command; the quick start adds a second online/offline toggle, with the offline side carrying the bundle note, per-OS commands, architecture hints and a Releases link. Offline commands live beside the online one-liners in `lib/links.ts`.
- The announcement bar drops from four rotating items to two: Kimi K3 with the free models, and the AMD Developer Program credits.
- The 0.1.5 release post ships in both languages (`penguinharness-0-1-5`), covering offline installs, attachments and input images, in-run LLM recovery, and the skill-library upgrades.
