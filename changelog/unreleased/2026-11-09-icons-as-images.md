# Icons are images, never markup, and may be PNG, JPEG, WebP, GIF or AVIF as well as SVG

- **Date:** 2026-11-09
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `ui`, `landing`
- **PR:** [#1514](https://github.com/Prism-Shadow/penguin-harness/pull/1514)

[中文版](2026-11-09-icons-as-images.zh.md)

A plugin's icon, and the copy beside every Skill and hook package it installs, used to reach the Web App as SVG text that the page inlined as markup. A deny-list was all that stood between that text and script running on the app's origin, which in the desktop app can reach the host's command interface. No icon enters a page as markup any more: the server serves each icon as an image, by URL, and the page draws it with `<img>` or as a CSS mask.

## Formats

An icon may be SVG, PNG, JPEG, WebP, GIF or AVIF, at most 256 KB. Its format is read from its bytes and must agree with its file name; an SVG is recognised by its `<svg` root after an optional byte-order mark, XML declaration and comments, and still passes the deny-list (script, animation, event handlers, links and external references are refused). A package names its icon with the card's `icon` field, or carries `icon.<ext>` at its root. Square is recommended; an icon is drawn whole inside its tile.

## Drawing

A monochrome SVG, one whose every paint is `currentColor` or `none`, is marked `tint` and drawn as a mask in the text colour, so the built-in line icons look as they did. Every other icon is drawn as itself. An icon whose image does not load falls back to the glyph of its kind: the book for a Skill, the hook for a hook package, the puzzle piece for a plugin.

## Serving

Listings carry `icon: { url, tint }`. The URL carries the image's content revision (`?rev=`) and is cached for good. The routes are `GET /api/plugins/:plugin/icon`, `GET /api/plugins/registry/icon?name=…`, `GET …/agents/:a/skills/:name/icon`, `GET …/agents/:a/hooks/:name/icon` and `GET /api/projects/:p/dir-skills/icon?path=…&name=…`. Each answers with the type the bytes are, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `Cross-Origin-Resource-Policy: same-origin`, and the Skill and hook routes only to Project members. A machine's Agents show their icons through the machine proxy.

## Installs

An install writes the icon as `icon.<ext>` for its format and leaves no icon of another format in the directory. A reader accepts whichever `icon.*` a directory holds, so an `icon.svg` written by an earlier install, or carried by a Skill you wrote, is read as before.

## Other surfaces

The site's plugin pages read icons by the same rules and draw them with the same component. The `plugin-porting` Skill now carries an upstream PNG logo when there is no SVG icon.
