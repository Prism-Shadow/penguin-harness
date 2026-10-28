# Attached images and files are one set of tiles, and a sent image is no longer an ellipse

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`, `docs`
- **PR:** [#1191](https://github.com/Prism-Shadow/penguin-harness/pull/1191)

[中文版](2026-10-17-attachment-tiles.zh.md)

In the Frost theme a sent image was drawn as an ellipse: it took the control radius, which Frost
sets to a pill (9999px), and that radius on a box that is not square rounds a rectangle into a
stadium. Attached images and files are now drawn by one family of tiles in the shared UI
package, in the composer before sending, in the sent message and inside a steer, with the box
radius the composer's chips use.

## Details

- `AttachmentList`, `AttachmentImage` and `AttachmentFile` joined `@prismshadow/penguin-ui`, all
  props-only. An image tile has a fixed height and follows the image's own ratio between two
  bounds; past a bound, or for an image smaller than the tile, the whole picture is fitted inside
  it on a neutral fill, never stretched, cropped or enlarged. A click opens it large. An image
  that fails to load keeps a square tile with the image glyph and says why on hover.
- A file tile shows the glyph of its kind (text, code, archive, image, other), its name, which
  truncates and shows whole on hover, and the extension and size under it.
- The composer draws its staged images and files as one row of tiles at the top of its card,
  each with a remove button that stays on screen; a long file name truncates before the button
  is pushed out.
- A sent message shows the same tiles above its text bubble: its images in one row, its files in
  the next, with one time footer. The images a vision model receives as separate image messages
  join the prompt they came with, so a prompt is one message and one outline anchor instead of a
  bubble per image. The "Attached files" notice is gone; each file has its tile.
- A steer's chip shows its images and files as one row of tiles at the composer's size.
- `MessageBubble` lost its `image` variant and `MessageImage`; `MessageAttachments` holds a
  prompt's rows. `ComposerCard` took an `attachments` slot. `Chip` lost the `outline` weight and
  the size readout that only the composer's file chips used.
- The UI gallery has an Attachments topic: the composer with working remove buttons, a sent
  message, a steer, every image ratio from a 16 px icon to a 10:1 panorama, phone width with a
  file name longer than any tile, and an image that fails to load. A browser spec measures the
  tiles in every theme.
- The chat guide describes the tiles.
