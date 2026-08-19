# New library skill: humanizer

- **Date:** 2026-08-11
- **Type:** feature
- **Scope:** `skills`
- **PR:** [#256](https://github.com/Prism-Shadow/penguin-harness/pull/256)

[中文版](2026-08-11-humanizer-skill.zh.md)

`humanizer` joins the built-in library under the Office Productivity group as a manual-install skill — `preinstall: false`, so it stays out of default_agent's preinstalled set and installs from the Skill Library on demand ([#256](https://github.com/Prism-Shadow/penguin-harness/pull/256)).

## What it does

Rewrites or edits prose in any language so it reads like edited human writing in the register of books, newspapers and encyclopedias rather than default AI output. The SKILL.md working surface is deliberately small: seven drafting principles (vary every pattern, density from anchored facts in whole grammar, a quota on quotable lines, a real writer with real material, structure serving content, native idiom and typography, verify-and-calibrate) under one meta-rule — aim for the natural distribution of edited prose, not a perfect scorecard. The detailed instrument ships as reference files read during the diagnostic census rather than during drafting: a 25-tell catalog in three layers (sentence patterns, discourse shapes, and the humanizing pass's own fingerprint), per-language surface forms for Chinese, English, Japanese, French, German and Spanish, and the measured case study behind every rule.

## How it was derived

Five empirical rounds, documented with counts in the skill's `reference/case-study.md`: a controlled baseline-versus-rewrite exercise; reader field tests that yielded the discourse-layer tells; a ten-piece, five-language blind cross-review by independent editor agents (two pieces double-reviewed for agreement, all pieces revised against accepted flags, the four worst re-scored blind with the average verdict dropping from ~71 to 30) that yielded the scrub layer; and two further user passes that caught successive overcorrections (telegraph compression, then clipped conditionals and connective monotony). One recurring result shaped the design: drafting against a long checklist produces compliance-shaped text, so the rules live in the diagnosis step and the drafting core stays small.
