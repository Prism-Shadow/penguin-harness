# A Security Model page in the docs

- **Date:** 2026-08-24
- **Type:** docs
- **Scope:** `docs`

[中文版](2026-08-24-security-docs.zh.md)

The reference section gains a Security Model page, organized as scenarios in the order a user
meets them: a feature inventory first, then first login (web and desktop), changing a password
by each of its four paths, automation on the local machine, remote machines — where ssh access
to a machine is stated plainly to equal CLI access on it — and taking access away, ending with
the leak-response scenario the design is built around: a leaked data-root backup is a
credential-rotation incident for the model keys it contains, not a forged-session incident. The
mechanics (token format, disk inventory, network surface) are collected at the end for
reference.
