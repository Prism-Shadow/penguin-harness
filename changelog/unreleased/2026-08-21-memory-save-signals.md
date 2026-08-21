# Memory prompt names when to save

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `core`, `docs`
- **PR:** [#397](https://github.com/Prism-Shadow/penguin-harness/pull/397)

[中文版](2026-08-21-memory-save-signals.zh.md)

The built-in `memory.prompt` said what is worth saving but not when to notice it, leaving the
judgement entirely to the model. It now names the moments that produce a durable fact:

- the user asks for the same thing again, or corrects a result in a way that holds beyond the
  current task — what they wanted instead is saved, with the why;
- a habit, convention or development practice stated more than once;
- a reusable working detail handed over that the Agent would otherwise have to ask for again — a
  service endpoint, a ticket or repository identifier, a preferred toolchain. The prompt's standing
  prohibition on credentials and personal data is restated at the signal, since the examples are
  the shape most likely to attract one.

A repeat is called a strong signal rather than a requirement, so one clear statement of a standing
preference still qualifies; when the Agent cannot tell whether something is worth keeping, it is
told to ask in the conversation.

## Details

- The prompt is a kernel-managed config leaf. The `2026-08-21` generation's `memory.prompt` hash was
  revised in place (that generation is unreleased); the five frozen older generations keep the
  previous hash, so an Agent whose stored prompt is still an old default is recognized as such and
  advanced by the kernel update. An Agent whose prompt was edited by hand keeps that edit and does
  not receive the new guidance; the only way to adopt it is Agent settings → Kernel → Restore
  default configuration, which replaces the whole config and is not scoped to the prompt.
- The Configuration guide's Memory chapter gained one sentence covering the same ground, in both
  languages.
