# Slash menu stays on screen; skill card buttons go horizontal and light

Two Web App polish fixes: the slash command menu could grow past the top of the viewport, and the skill card actions change arrangement again.

- The slash menu (which lists /compact plus every installed skill) now caps its height at min(20rem, 40vh) with internal scrolling, so its top edge never leaves the screen; the active row keeps itself scrolled into view for keyboard navigation.
- Skill card actions return to a single horizontal row (still equal squares, vertically centered at the card's right edge), and all three buttons now wear the light secondary background.
