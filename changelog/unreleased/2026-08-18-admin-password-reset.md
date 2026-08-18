# Offline admin password reset: `penguin server reset-admin-password`

The admin resets every other user's password from the user-management page, but a forgotten **admin** password had no recovery path once it was changed from the initial one (the plaintext file in the data root only survives while the password is still initial). A new CLI subcommand closes the gap from the machine that owns the data root:

```bash
penguin server reset-admin-password
```

- Refuses while a live server owns the root (`web.db` is single-writer) and points at the running instance; with the server stopped it resets the built-in `admin` to a fresh random `penguin-<4 digits>` initial password and prints it in the same framed notice the server shows on startup.
- The whole initial-password machinery is re-armed: `password_is_initial` set, the plaintext stored owner-only in the data root, the framed reminder re-printed on every server start until the password is changed — and all of admin's sign-in sessions are cleared, matching an admin-initiated reset.
- Nothing-to-reset roots are reported without side effects: a missing `web.db` is never created by the command, and an unseeded database is called out as such.
- Implementation: a side-effect-free `@prismshadow/penguin-server/reset-admin-password` subpath export (like `./lock`), so the CLI runs the reset without importing the server entry, which starts listening. Authorization is local filesystem access — whoever can run it already owns the SQLite database next to the file it writes.
