# The company sidebar shows the organization the page is on

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `web`
- **PR:** [#824](https://github.com/Prism-Shadow/penguin-harness/pull/824)

[中文版](2026-09-22-company-last-org-adoption.zh.md)

Opening an organization's page in company mode could leave the sidebar — its desks, its
channels — on the organization opened *last time*, so the page said one company and the
sidebar listed another's employees, and switching organizations looked as if the new one had
no Sessions.

## Details

- The shell adopts the organization last opened (a stored preference) when no route names
  one. That decision was taken on the values of the render that scheduled it; an organization
  route sets the current organization in its own effect, which runs first in the same commit,
  so the shell still saw "none" and adopted the stored one over the route's.
- The decision is now a store method, `adoptLastOrg`, that reads the store as it is at that
  moment: a route's choice stands, and the stored organization is adopted only while nothing
  names one.
