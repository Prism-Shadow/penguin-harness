# Open an activity image full size over the page

- **Date:** 2026-09-25
- **Type:** feat
- **Scope:** `web`

Selecting a previewed image in the asset editor, including image candidates and the
**Current and new** comparison, now opens it full size over the page instead of only in a
new browser tab. A hint under the image says so, and the new-tab link stays as a second way
to open or save it.

- The full-size view is a dialog named by the asset's description. Escape, the close
  button or a click on the backdrop closes it, and focus returns to the image.
- The shared image lightbox (also used by chat) joins the dialog Escape stack, so inside
  another dialog Escape closes only the lightbox. It can also report when its thumbnail has
  loaded, which keeps the image's pixel dimensions under the preview.
