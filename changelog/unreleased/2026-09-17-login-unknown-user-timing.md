# A login for an unknown username costs the same scrypt check as a wrong password

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`
- **PR:** [#774](https://github.com/Prism-Shadow/penguin-harness/pull/774)

[中文版](2026-09-17-login-unknown-user-timing.zh.md)

A sign-in with a username that has no account returned without running scrypt, while a wrong password on a real account paid for a full derivation. At production cost the first answered in well under a millisecond and the second took tens of milliseconds, so response time told which usernames exist. An unknown username is now checked against a dummy hash, and both failures return the same 401 `invalid_credentials` body after one derivation.

## Details

- `verifyAccountPassword` runs exactly one scrypt derivation per call. If the account is missing, its hash is empty, or its hash cannot be checked (wrong format, or parameters scrypt refuses), it checks the password against the dummy hash instead and fails the sign-in.
- `AuthService.login` makes the dummy hash with the server's own password hasher, so the dummy carries the same cost parameters as real hashes. The hash is computed on the first sign-in that needs it and then kept.
