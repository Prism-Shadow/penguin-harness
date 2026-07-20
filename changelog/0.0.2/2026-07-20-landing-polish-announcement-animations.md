# Landing polish: sliding announcements, construction animation, trend value labels, feature split

A polish pass over the landing page's motion and grouping, plus web-first usage guidance in the blog.

- **Announcement bar** — light brand-tinted background; both entries now link to blog posts (the new-models entry to the launch post, the credits entry to the AMD post); switching SLIDES horizontally (auto-advance, hover pause) with dot indicators instead of arrows; the trailing arrow icon is gone.
- **LangChain comparison** — a looping "construction" animation on a shared cycle: the LangChain card lays one gray block at a time and never tops out before the cycle resets, while the PenguinHarness card raises a whole brand-blue skyline in under two seconds and holds it. Reduced-motion shows both skylines complete.
- **Self-improvement trends** — the three outcome charts are now driven by one rAF clock, and a value label rides each curve's moving head (score climbing, cost and time falling), changing as the line draws; reduced-motion shows the finished line with its final value.
- **Features split by capture** — only the three features with real screenshots (multi-session chat, trace view, agent evaluation) form the tab bar; the remaining six sit below as the classic card grid, closed with an "and more…" card.
- **Blog usage goes web-only** — the launch post's getting-started and the AMD post's setup now guide through `penguin web` and the Models page only; the CLI config/run alternatives are removed to funnel users into the Web UI.
