# Landing site

The penguin.ooo landing page: story, structure, animations, navigation, and the install domain.

## Landing, README, and blog retell one story, with penguin.ooo/install.sh

The marketing surfaces now tell the same 1x/100x story, persuade through one numbered "Why" section, and install from the site's own domain.

- **penguin.ooo/install.sh** — the landing site ships a thin `public/install.sh` that forwards to the latest GitHub release installer (GitHub Pages cannot serve real redirects), so `curl -fsSL https://penguin.ooo/install.sh | sh` works everywhere; the hero command, README (en/zh), docs installation/quickstart (en/zh), and blog posts all switch to it.
- **Landing** — the hero replaces the rotating-word headline with the two-line story ("With LangChain, you build agents by hand — at 1x; with PenguinHarness, agents build agents — at 100x", the 100x fragment in brand color) plus the "zero-code Harness CLI and Web UI, 1000+ models" subtitle. One numbered Why section (1 benchmark suites + DeepSeek tuning, 2 one-sentence build demo with the real RAG shot, 3 self-evolution loop with a "demo video coming soon" pill) absorbs the former Pillars / Showcase / Benchmark / SelfImprove sections; UI screenshots leave the home page; nav anchors become why / quickstart / contract / features (reason 1 keeps the #benchmark anchor). The blog already shares the landing Nav, theme, and language settings.
- **README (en/zh)** — subtitle now says "Harness CLI and Web UI"; website/docs/blog/community links render as shields.io badges; the top screenshot and the Changelog-Blog-Docs section are gone; the three reasons sit numbered with emoji under "Why PenguinHarness"; the models table keeps only a one-line "any OpenAI-protocol endpoint works" note; requirements become a table; install sections gain emoji; the roadmap adds a desktop app and Windows support; the credits link LlamaFactory, the PrismShadow AI Team, and Fable 5.
- **Blog** — the introduction post (en/zh) leads with the same story line and phrasing.

## Landing back to the classic structure, with tabbed features/cases and a docs-matching nav

The previous landing overhaul went too far; the classic section set returns, with the new material folded in as tabs and side sections instead of replacements.

- **Restored as they were**: the rotating hero headline ("Efficient Self-Improving Harness for Developers/Enterprises"), the three pillars, the self-improvement loop (now with a "demo video coming soon" pill), Quickstart, the standalone Benchmark section, CONTRACT.md, and Security.
- **LangChain comparison moved, not deleted**: the 1x/100x story lives in its own compact section after the pillars — two cards (LangChain, hand-built, 1x, de-emphasized vs PenguinHarness, agents building agents, 100x, brand-emphasized) with the story sentence as the subtitle.
- **Features become switchable tabs**: all nine feature descriptions remain, each as a tab with its icon; the three views with real captures — multi-session chat, Trace view, Agent evaluation — show their locale/theme-matched screenshot in the active panel, bringing the Trace and benchmark shots back onto the page.
- **Use cases become tabs too**: a Cases section with a tab bar holds the RAG case only for now (prompt + captured result); future cases append as tabs.
- **Community section added at the end**: Discord / X / WeChat group / GitHub as outbound cards after the CTA.
- **Docs nav now mirrors the landing nav exactly** — same link row (Highlights / Quick start / Benchmark / CONTRACT.md / Features / Blog / Docs) with the same sliding hover pill, anchoring into the landing one level up, so the two sites link seamlessly; the old standalone "Website" link is absorbed by the row.
- **Launch blog post back to its original skeleton**: the "Why PenguinHarness" three-pillar bullets, the benchmark section wording, and the closing "start right now" paragraph return, with the GDPevo origin story, images, models table, roadmap, and community call-to-action kept as additions rather than replacements.

## Landing trace screenshots: same opened timeline in English and Chinese

The English trace screenshots showed the empty "select a Session" state while the Chinese ones showed a full trace; all four now capture the same opened trace with stats and an execution timeline containing tool calls.

- The capture script navigated to `/traces?sessionId=...` — but the traces page only honors the session deep link when `agentId=` is present (the product's own links always carry both), so selection relied on a fragile title click that silently failed for English via `.catch()`. The script now uses the canonical `?agentId=default_agent&sessionId=...` deep link and waits for the timeline's `exec_command` lanes before shooting, so an empty capture fails loudly instead of shipping.
- The scripted English session title was 31 chars and core clips titles at `TITLE_MAX_CHARS = 30`, producing "…Agent ap" in the shots; the mock title is now "Build a data-analysis Agent" (27 chars).
- Regenerated `traces-{en,zh}-{light,dark}.webp`; chat and benchmark shots are unchanged.

## Landing polish: sliding announcements, construction animation, trend value labels, feature split

A polish pass over the landing page's motion and grouping, plus web-first usage guidance in the blog.

- **Announcement bar** — light brand-tinted background; both entries now link to blog posts (the new-models entry to the launch post, the credits entry to the AMD post); switching SLIDES horizontally (auto-advance, hover pause) with dot indicators instead of arrows; the trailing arrow icon is gone.
- **LangChain comparison** — a looping "construction" animation on a shared cycle: the LangChain card lays one gray block at a time and never tops out before the cycle resets, while the PenguinHarness card raises a whole brand-blue skyline in under two seconds and holds it. Reduced-motion shows both skylines complete.
- **Self-improvement trends** — the three outcome charts are now driven by one rAF clock, and a value label rides each curve's moving head (score climbing, cost and time falling), changing as the line draws; reduced-motion shows the finished line with its final value.
- **Features split by capture** — only the three features with real screenshots (multi-session chat, trace view, agent evaluation) form the tab bar; the remaining six sit below as the classic card grid, closed with an "and more…" card.
- **Blog usage goes web-only** — the launch post's getting-started and the AMD post's setup now guide through `penguin web` and the Models page only; the CLI config/run alternatives are removed to funnel users into the Web UI.

## Announcement carousel: one-direction slide, arrow kept, dots removed

The announcement bar keeps the small arrow marking each entry as a click-through link, drops the dot switch buttons on the right, and auto-rotates by sliding in ONE direction only: a clone of the first slide follows the last, and once the clone is fully in view the track snaps back without animation — the bar never visibly slides backwards. Hovering still pauses the rotation.

## Feature tabs drop the description card

The three screenshot-backed feature tabs no longer render an icon card above the capture; the feature's one-line description now sits as centered text directly above the image (the tab chip already carries the title and icon). The no-capture features keep their card grid below.

## Trend value labels carry units with animated decimals

The self-improvement loop's three outcome labels now read as real measurements while they ride the curve head: score as a percentage with one decimal (79.0%), cost in dollars with two decimals ($0.25), and time in seconds with one decimal (83.0s) — the decimal part animates continuously along with the line.

## Fix the nav hover highlight sweeping in from the edge

The landing and docs navs' sliding hover pill animated from its hidden state at the nav's left edge, so the first hover sent a gray pill flying across the whole link row (and it slid back on leave).

The pill now appears IN PLACE under the first link it lands on — the position jumps with only the fade animating — slides while moving between links, and fades out where it is when the pointer leaves. Applied identically to the landing nav and the landing-parity docs nav.

## Merge main to restore the persistent nav active highlight

The branch predated main's PR #6 ("correct navigation state and anchor scrolling"), so it was missing the nav's persistent active highlight — the black chip that marks the current section or route — and would have reverted that fix on merge. Merging origin/main brings it back and reconciles it with the branch's nav work.

- Landing nav: section links route through `/#id` again with `getActiveNavItem` tracking (new `lib/nav-state.ts` + tests), the active link keeps its black chip with `aria-current`, and the branch's in-place hover pill behavior is preserved on top.
- Also restored from #6: anchor targets scroll below the sticky header via `.section-anchor` (ids moved onto the section's inner div), footer/hero/CTA anchors as router links, and the docs brand logo returning to the landing site.
- Docs nav (landing-parity) additionally marks its own "Docs" link as the current page with the same black chip.

## Nav highlight follows the live scroll position

The nav's black current-item chip previously updated only from the URL hash (i.e. on click); while scrolling, it stayed stale. A scroll-spy hook now measures the five section anchors on every scroll frame (rAF-throttled, document-level capture so any scrolling container works) and lights up the LAST section whose top has crossed the activation line under the sticky header — null above the first section, and in-between sections keep the previous anchor lit. On the home page the highlight is fully live; other routes keep route-based state (Blog).

## The Cases tab shows the finished RAG app with a localized prompt

The RAG case now displays the condensed claude-code-docs configuration-expert prompt from the strings catalog (localized zh/en) and the finished-product app screenshot matched to the visitor's locale and theme, replacing the shared English prompt and the PenguinHarness chat capture.
