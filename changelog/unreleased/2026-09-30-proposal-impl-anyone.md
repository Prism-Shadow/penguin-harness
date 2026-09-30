# Anybody in the organization registers an impl PR or runs the adoption

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `cli`

[中文版](2026-09-30-proposal-impl-anyone.zh.md)

`penguin org proposal impl <n> <url>` (`PUT …/proposals/:number/impl`) no longer answers 403 `not_author` to an employee that is neither the proposal's author nor its implementer, and `penguin org proposal impl --adopt` (`POST …/proposals/adopt-impl`) no longer answers 403 `person_required` to an employee. Anybody in the organization may run both, a person or an employee; a caller outside it is still refused. Every `impl` line still records who wrote it (`by`), and a PR that is already another proposal's impl PR is still refused with 409 `impl_pr_taken`.
