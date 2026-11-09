# Drop the README catalog check

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `ci`, `server`
- **PR:** [#1465](https://github.com/Prism-Shadow/penguin-harness/pull/1465)

[中文版](2026-11-04-readme-catalog-check-removed.zh.md)

The README plugin tables are no longer tested against the shipped plugin library: the `README catalog` CI job, the planner's `readme` selection and the README tables' scenarios in `packages/server/test/plugin-library.test.ts` are removed. A change to a catalog README now selects no CI job, as other documentation does. The tables are kept by hand and checked in review.
