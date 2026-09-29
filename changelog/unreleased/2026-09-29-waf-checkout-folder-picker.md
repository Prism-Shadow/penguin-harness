# Pick the WAF checkout folder from the server's folders

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `web`, `activities`

**Settings → WAF workspace → Checkout folder** is now a folder picker instead of a text box. It browses the server's folders the same way the chat's workspace picker does. The path at the top of the menu can still be typed or pasted, and **Let Penguin manage its own** clears the field. Nothing is saved until **Save**.

- **The folder picker now handles Windows paths.** It starts browsing from a filled `C:\…` or `\host\…` path, and names a folder by its last segment whichever separator the path uses. This also fixes the chat workspace picker on Windows servers.
