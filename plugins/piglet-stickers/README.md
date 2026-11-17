# Piggy Sticker World

A pastel sticker game starring an emoji-style piglet: decorate little rooms and gardens with pigs, furniture and snacks, then keep them as pictures.

## What it does

- Gives you 208 stickers in seven trays (pigs, furniture, plants, food, decor, nature and everyday things) to place on a canvas, then drag, resize, rotate, flip, layer, copy and lock.
- The pigs are one original character drawn for this game: a wide bean-shaped face, small upright ears whose tips fold forward, a pill-shaped snout and glossy eyes, in 36 costumes. Double-click a pig on the canvas to change its face.
- Offers 13 scenes, from a pink bedroom and a strawberry garden to a starry campsite, plus a blank canvas.
- Sets ten themed levels, three daily goals and a blind box; the stars they give unlock four limited pigs.
- Keeps your scenes under My works and exports any of them as a 1600 × 1600 PNG.
- Speaks Chinese or English: it follows your device's language, and the language button on the home page and in every top bar switches it and remembers your choice.

## Get started

1. On the Plugins page, install Piggy Sticker World onto an Agent (it is not preinstalled on any Agent).
2. Open the Agent's **Piggy Sticker World** tab beside its chat, or its tile in the **App Center**.
3. The first three things to click:
   - **Start building**, then a scene card.
   - A sticker in the tray at the bottom: it lands on the canvas. Drag it to move it, drag a corner to resize it, double-click a pig to change its face.
   - The save icon in the top bar, to keep the scene under **My works**. The download icon next to it exports a PNG.

For a goal to play towards, open **Theme levels** from the home page.

## Your data

- **Where progress lives.** Stars, today's goals, cleared levels, collected and favourite stickers, the sound switch, the language you picked, the current draft and your saved works are kept by the workbench on your PenguinHarness server, in its own state, one copy per Agent. The browser's local storage is a cache of it: open the tab in another browser and your progress appears after one automatic reload.
- **What goes over the network.** The page talks only to its own workbench on the PenguinHarness server you are signed in to, to load and store those saves. Nothing else is contacted: the stickers and scenes are drawn by the page, sounds are synthesised in the browser, and PNG export happens in the browser.
- **Removing it.** Removing the workbench from the Agent, or uninstalling the plugin from it, deletes its saves on the server. A plugin update keeps them. The browser you last played in still holds a cached copy until you clear that site's data; if the workbench is installed again on the same Agent, that browser sends the cached progress back.

## Make it yours

The workbench is source code in the Agent's own files, so you can ask the Agent to change it. For example:

- "Add a library scene with tall bookshelves and a reading lamp, and an eleventh level there that needs two pigs and three books."
- "Add an autumn set to the Nature tray: a chestnut, an acorn, a pine cone and a red maple leaf, drawn in the same pastel style."

Where things are, under `workbenches/piglet-stickers/ui/`: `art.js` holds the drawing helpers, the piglet (`pig()`) and its hats, outfits and props; `stickers.js` the sticker registry; `scenes.js` the scenes; `game.js` the game; and `i18n.js` every text in both languages, the stickers' names included. Sticker ids are positional, so a new sticker goes at the end of its list, with its name added to both dictionaries.

Updating the plugin replaces this source with the new version, your Agent's edits included; your saves stay.

## Licence and credits

- Apache-2.0, see [LICENSE](LICENSE).
- By Prism-Shadow, built from a workbench contributed by the PenguinHarness community. The piglet was redrawn for this release as an original character.
- Nothing is bundled from elsewhere: every sticker, scene and sound is made by the page's own code, and the page uses the system's fonts. The plugin ships no image, font or audio file.
