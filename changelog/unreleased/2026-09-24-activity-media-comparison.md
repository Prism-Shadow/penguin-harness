# Compare new media with the current before replacing it

- **Date:** 2026-09-24
- **Type:** feat
- **Scope:** `web`

When an asset already has media, the asset editor now shows a replacement beside what is
bound, under **Current and new**, instead of swapping it in at once:

- Uploading another file for a bound asset holds the upload next to the current file.
  **Use new** binds it; **Keep current** leaves the binding alone, and the file stays in
  the media library.
- The newest generated speech or image that has not been accepted is played or shown
  next to the accepted one. **Use new** accepts it; **Keep current** puts it aside, and
  it stays in the candidates list.

It also fixes a garbled separator in the image candidates' date line.
