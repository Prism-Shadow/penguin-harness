# The community health files GitHub looks for, all under .github/

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `docs`, `tooling`
- **PR:** [#514](https://github.com/Prism-Shadow/penguin-harness/pull/514)

[中文版](2026-08-27-community-standards.zh.md)

GitHub's Community Standards page listed five unchecked entries — code of conduct,
contributing, security policy, issue templates, pull request template. All five were
written, and every file GitHub recognizes from inside `.github/` was placed there, so no
new file was added at the repository root.

## Details

- `CONTRIBUTING.md` **moved** from the root to `.github/CONTRIBUTING.md` (a rename, not a
  copy) with its content intact and its repo-relative links re-anchored one level up. It
  gained a Code of Conduct and security-policy pointer at the top, a section on filing a
  bug or a feature request, and a pull-request bullet naming the English title, the
  `## Verification` section and the template. The four references to it — in `README.md`,
  `README.zh.md`, `.github/workflows/release.yml` and the `penguin-harness-dev` skill —
  were repointed at the new path.
- `.github/CODE_OF_CONDUCT.md` was added as the Contributor Covenant 2.1 verbatim, with
  <hiyouga@buaa.edu.cn> filled in as the enforcement contact, and its Chinese counterpart
  took the Covenant's own zh-cn translation. Neither file was written as a paraphrase, so a
  later version bump stays a clean diff against upstream.
- `.github/SECURITY.md` was written to route reports to GitHub's private "Report a
  vulnerability" form, with the maintainer's address as the fallback, and to state that
  only the most recent release is supported — the project is pre-1.0, ships from `main`,
  and backports nothing. It also drew the scope line the product needs: an approval
  bypass, a `[command_policy]` evasion, a credential reaching a log or a Trace, and a
  break in the server's multi-user boundary are in scope, while an agent doing what an
  approved tool call permits is the documented design.
- `.github/ISSUE_TEMPLATE/` gained `bug_report.yml` and `feature_request.yml` as form
  schemas, plus a `config.yml` that turns off blank issues and links Discord, the docs and
  the security advisory form. The bug form asks for the version (`penguin version`), the
  install shape, the OS, and whether the problem survives a fresh data root; both forms and
  the contributor guide state plainly that a config file, a `.env` or a full log is likely
  to carry a provider key or a bot token and does not belong in a public issue.
- `.github/PULL_REQUEST_TEMPLATE.md` was added, asking for what changed, a
  `## Verification` section naming what was run, and a changelog entry pair under
  `changelog/unreleased/`.
- The two documents a reporter or a newcomer reads rather than a maintainer — the Code of
  Conduct and the security policy — shipped with `.zh.md` counterparts, as did the
  contributor guide. The GitHub-rendered templates did not.
